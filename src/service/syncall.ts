import { createNewContext, IContext } from '../context';
import { getExtractorBySystemType, IBrowseResult, IExtractor } from '../extractor';
import {
    IStageResource,
    ISystem,
    RedisClient,
    ResourceDatastore,
    SyncallStatus,
    SyncallWorkflowDatastore,
    SystemDatastore,
    VERSION_REFERENCED_ONLY,
} from '../dao';
import { getLogger } from '../logger';
import { AsyncTaskService, AsyncTaskUniqueId } from './task';
import { convertExtractedResourceToStage } from './autoExtraction';
import { IngestService } from './ingest';
import { CatalogError } from '../error';

const logger = getLogger(__filename);

export class BreakingError extends CatalogError {
    constructor(message: string, details: any) {
        super(message, 500, details);
    }
}

export class SystemNotFoundError extends BreakingError {
    constructor(systemId: string) {
        super('system not exist', { systemId });
    }
}

export class UnknownSyncallWorkflowError extends BreakingError {
    constructor(workflowId: string) {
        super('unknown workflowId', { workflowId });
    }
}

export class SystemTypeNotSupportError extends BreakingError {
    constructor(system: ISystem) {
        super('system type not supported', { ...system });
    }
}

export class SyncAllService {
    private resourceStore: ResourceDatastore;
    private systemStore: SystemDatastore;
    private taskq: AsyncTaskService;
    private workflow: SyncallWorkflowDatastore;
    private ingest: IngestService;

    constructor(
        resourceStore: ResourceDatastore,
        systemStore: SystemDatastore,
        taskq: AsyncTaskService,
        redis: RedisClient,
        ingest: IngestService
    ) {
        this.resourceStore = resourceStore;
        this.systemStore = systemStore;
        this.workflow = new SyncallWorkflowDatastore(redis);

        this.taskq = taskq;
        this.registerAsyncTask();

        this.ingest = ingest;
        this.ingest.setIngestCallback(this.createMonitorIngestTask.bind(this));
    }

    async start(ctx: IContext, systemId: string): Promise<string> {
        logger.info(ctx, `starting sync all for system: ${systemId}`);

        const target = await this.systemStore.get(ctx, systemId);
        if (!target) {
            throw new SystemNotFoundError(systemId);
        }

        const workflowId = await this.workflow.createNewWorkflow(ctx, target);
        logger.info(ctx, `sync all workflow created, workflow id=${workflowId}`);

        await this.taskq.push(ctx, AsyncTaskUniqueId.BROWSE, workflowId);
        logger.debug(ctx, `browse job pushed`);

        return workflowId;
    }

    async handleBrowse(workflowId: string) {
        const { ctx, system } = await this.getSyncallContext(workflowId);

        if (!this.compareAndSetStatus(ctx, workflowId, SyncallStatus.BROWSING)) {
            return;
        }

        const browsedResources = await this.browse(ctx, workflowId, system);
        const current = await this.resourceStore.getResourceVersions(ctx, system.id);

        const { deleted, outdated } = await this.compareResourcesToRefresh(
            ctx,
            workflowId,
            browsedResources,
            current
        );

        await this.stageDeletedResources(ctx, deleted, system, workflowId);
        await this.workflow.cacheOutdated(workflowId, outdated);

        await this.workflow.setWorkflowStatus(workflowId, SyncallStatus.BROWSED);

        await this.taskq.push(ctx, AsyncTaskUniqueId.EXTRACT, workflowId);
        logger.info(ctx, 'browse completed');
    }

    async handleExtract(workflowId: string) {
        const { ctx, system } = await this.getSyncallContext(workflowId);

        if (!this.compareAndSetStatus(ctx, workflowId, SyncallStatus.EXTRACTING)) {
            return;
        }

        const extractor = this.getExtractorBySystemType(ctx, system);

        const resourceIds = await this.workflow.getOutdatedResources(workflowId);
        logger.info(ctx, `Extracting ${resourceIds.length} resources`);

        const resources = await extractor.extractBatch(ctx, resourceIds);
        logger.info(ctx, `Extracted ${resources.length} resources, staging`);

        await this.ingest.stage(
            ctx,
            resources.map(extracted =>
                convertExtractedResourceToStage(ctx.tenantId, extracted, workflowId)
            )
        );

        logger.info(ctx, 'Extract completed');

        await this.workflow.setWorkflowStatus(workflowId, SyncallStatus.INGESTING);
    }

    async handleMonitorIngest(workflowIds: string[]) {
        for (let workflowId of workflowIds) {
            logger.info(`resources are ingested for workflow, workflow id=${workflowId}`);

            const { ctx, system } = await this.getSyncallContext(workflowId);

            const left = await this.ingest.countUningested(ctx, workflowId);
            if (left === 0) {
                await this.workflow.setWorkflowStatus(workflowId, SyncallStatus.COMPLETED);
                logger.info(ctx, 'Workflow completed');
            } else {
                logger.info(ctx, `Ingest monitoring: ${left} remaining`);
            }
        }
    }

    async getWorkflowStatus(ctx: IContext, workflowId: string): Promise<SyncallStatus> {
        const status = await this.workflow.getWorkflow(workflowId);
        return status.status;
    }

    private async compareResourcesToRefresh(
        ctx: IContext,
        workflowId: string,
        browsed: IBrowseResult[],
        current: IBrowseResult[]
    ): Promise<{ deleted: IBrowseResult[]; outdated: string[] }> {
        const deleted: IBrowseResult[] = [];
        const outdated: string[] = [];

        const currentMap = new Map<string, number>();
        current.forEach(res => {
            currentMap.set(res.nativeUniqueName, res.version);
        });

        const browsedResources = new Map<string, number>();
        browsed.forEach(res => {
            browsedResources.set(res.nativeUniqueName, res.version);

            const cur = currentMap.get(res.nativeUniqueName);
            if (cur && cur >= res.version) {
                return;
            }
            outdated.push(res.nativeUniqueName);
        });

        current.forEach(res => {
            const cur = browsedResources.get(res.nativeUniqueName);
            if (!cur) {
                // do not delete referenced-only assets
                if (res.version !== VERSION_REFERENCED_ONLY) {
                    deleted.push(res);
                }
            }
        });

        await this.workflow.set(workflowId, 'deleted', deleted.length);
        await this.workflow.set(workflowId, 'outdated', outdated.length);

        logger.info(ctx, `Found ${deleted.length} deleted, ${outdated.length} outdated`);
        return { deleted, outdated };
    }

    private async stageDeletedResources(
        ctx: IContext,
        deleted: IBrowseResult[],
        system: ISystem,
        workflowId: string
    ) {
        const stageDeleted: IStageResource[] = deleted.map(res => {
            return {
                tenantId: ctx.tenantId,
                nativeUniqueName: res.nativeUniqueName,
                version: res.version,
                deletedAt: new Date(),
                metadata: '',
                workflowId: workflowId,

                system,
            };
        });
        await this.ingest.stage(ctx, stageDeleted);
    }

    private async createMonitorIngestTask(workflowIds: string[]) {
        const ctx = createNewContext('createMonitorIngestTask');
        await this.taskq.push(ctx, AsyncTaskUniqueId.MONITOR_INGEST, workflowIds);
    }

    private async compareAndSetStatus(
        ctx: IContext,
        workflowId: string,
        status: SyncallStatus
    ): Promise<boolean> {
        const { old, set } = await this.workflow.setWorkflowStatus(workflowId, status);

        if (!set && old === SyncallStatus.TIMEOUT) {
            logger.info(ctx, `syncall abort when ${status} since it's already timeout`);
            return false;
        }

        return true;
    }

    private async getSyncallContext(
        workflowId: string
    ): Promise<{ ctx: IContext; system: ISystem }> {
        const desc = await this.workflow.getWorkflow(workflowId);
        if (!desc) {
            throw new UnknownSyncallWorkflowError(workflowId);
        }
        const ctx = createNewContext(desc.tenantId, desc.correlationId);

        return { ctx, system: desc.system };
    }

    private getExtractorBySystemType(ctx: IContext, system: ISystem) {
        const extractor = getExtractorBySystemType(ctx, system.type, system.uniqueIdentifier);

        if (!extractor) {
            logger.error(ctx, `Extractor not found for type: ${system.type}`);
            throw new SystemTypeNotSupportError(system);
        }

        return extractor;
    }

    private async browse(ctx: IContext, workflowId: string, system: ISystem) {
        const extractor = this.getExtractorBySystemType(ctx, system);

        logger.info(ctx, 'browsing resources');
        const browsedResources = await extractor.browse(ctx, system.id);
        logger.info(ctx, `browsed ${browsedResources.length} resources`);

        await this.workflow.set(workflowId, 'browsed', browsedResources.length);
        return browsedResources;
    }

    private registerAsyncTask() {
        this.taskq.register({
            uniqueId: AsyncTaskUniqueId.BROWSE,
            handler: this.handleBrowse.bind(this),
        });
        this.taskq.register({
            uniqueId: AsyncTaskUniqueId.EXTRACT,
            handler: this.handleExtract.bind(this),
        });
        this.taskq.register({
            uniqueId: AsyncTaskUniqueId.MONITOR_INGEST,
            handler: this.handleMonitorIngest.bind(this),
        });
    }
}
