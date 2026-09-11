import { createGlobalContext, createNewContext, IContext } from '../context';
import { getExtractorBySystemType, IBrowseResult, IExtractedResource } from '../extractor';
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

const logger = getLogger(__filename);

const errorSystemNotExist = new Error('system not exist');

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

        this.ingest = ingest;
        this.ingest.setIngestCallback(this.createMonitorIngestTask.bind(this));
    }

    async start(ctx: IContext, systemId: string): Promise<string> {
        logger.info(ctx, `starting sync all for system: ${systemId}`);

        const target = await this.systemStore.get(ctx, systemId);
        if (!target) {
            logger.error(ctx, `System not found: ${systemId}`);
            throw errorSystemNotExist;
        }

        const workflowId = await this.workflow.createNewWorkflow(ctx, target);

        logger.info(ctx, `sync all workflow created, workflow id=${workflowId}`);

        await this.taskq.push(ctx, AsyncTaskUniqueId.BROWSE, workflowId);
        logger.info(ctx, `browse job pushed`);

        return workflowId;
    }

    async handleBrowse(workflowId: string) {
        const { ctx, system } = await this.getSyncallContext(workflowId);

        if (!this.compareAndSetStatus(ctx, workflowId, SyncallStatus.BROWSING)) {
            return;
        }

        const extractor = getExtractorBySystemType(ctx, system.type, system.uniqueIdentifier);

        if (!extractor) {
            logger.error(ctx, `Extractor not found for type: ${system.type}`);
            return;
        }

        logger.info(ctx, 'Browsing resources');

        const browsedResources = await extractor.browse(ctx, system.id);

        logger.info(ctx, `Browsed ${browsedResources.length} resources`);

        const current = await this.resourceStore.getResourceVersions(ctx, system.id);

        const { deleted, outdated } = this.compareResourcesToRefresh(
            ctx,
            browsedResources,
            current
        );

        logger.info(ctx, `Found ${deleted.length} deleted, ${outdated.length} outdated`);

        await this.stageDeletedResources(ctx, deleted, system, workflowId);
        await this.workflow.cacheOutdated(workflowId, outdated);

        await this.workflow.setWorkflowStatus(workflowId, SyncallStatus.BROWSED);

        await this.taskq.push(ctx, AsyncTaskUniqueId.EXTRACT, workflowId);
        logger.info(ctx, 'Browse completed');
    }

    async handleExtract(workflowId: string) {
        const { ctx, system } = await this.getSyncallContext(workflowId);

        if (!this.compareAndSetStatus(ctx, workflowId, SyncallStatus.EXTRACTING)) {
            return;
        }

        const extractor = getExtractorBySystemType(ctx, system.type, system.uniqueIdentifier);

        if (!extractor) {
            logger.error(ctx, `Extractor not found for type: ${system.type}`);
            return;
        }

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

    private compareResourcesToRefresh(
        ctx: IContext,
        browsed: IBrowseResult[],
        current: IBrowseResult[]
    ): { deleted: IBrowseResult[]; outdated: string[] } {
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
            logger.info(ctx, `abort ${status} since it's already timeout`);
            return false;
        }

        return true;
    }

    private async getSyncallContext(
        workflowId: string
    ): Promise<{ ctx: IContext; system: ISystem }> {
        const desc = await this.workflow.getWorkflow(workflowId);
        if (!desc) {
            logger.error({ workflowId }, 'workflow description not found');
            throw new Error(`unknown workflow ${workflowId}`);
        }
        const ctx = createNewContext(desc.tenantId, desc.correlationId);

        return { ctx, system: desc.system };
    }
}
