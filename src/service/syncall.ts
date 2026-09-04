import { createNewContext, IContext } from '../context';
import { getExtractorBySystemType, IBrowseResult, IExtractedResource } from '../extractor';
import {
    IStageResource,
    ISystem,
    RedisClient,
    ResourceDatastore,
    SyncAllWorkflow,
    SyncStatus,
    SystemDatastore,
    VERSION_REFERENCED_ONLY,
} from '../dao';
import { getLogger } from '../logger';
import { AsyncJobService, AsyncTaskUniqueId } from './asyncJob';
import { convertExtractedResourceToStage } from './autoExtraction';
import { IngestService } from './ingest';

const logger = getLogger(__filename);

const errorSystemNotExist = new Error('system not exist');

export interface IObjectsToRefresh {
    deleted: IBrowseResult[];
    outdated: string[];
}

export interface ISyncAllStatus {
    status: SyncStatus;
}

export class SyncAllService {
    private resourceStore: ResourceDatastore;
    private systemStore: SystemDatastore;
    private taskq: AsyncJobService;
    private workflow: SyncAllWorkflow;
    private ingest: IngestService;

    constructor(
        resourceStore: ResourceDatastore,
        systemStore: SystemDatastore,
        taskq: AsyncJobService,
        redis: RedisClient,
        ingest: IngestService
    ) {
        this.resourceStore = resourceStore;
        this.systemStore = systemStore;
        this.workflow = new SyncAllWorkflow(redis);

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
        logger.info(ctx, `Starting sync for system: ${systemId}`);

        const target = await this.systemStore.get(ctx, systemId);
        if (!target) {
            logger.error(ctx, `System not found: ${systemId}`);
            throw errorSystemNotExist;
        }

        const workflowId = await this.workflow.createNewWorkflow(
            ctx.tenantId,
            ctx.correlationId,
            target
        );

        logger.info(ctx, `Workflow created, workflow id=${workflowId}`);

        const jobId = await this.taskq.push(ctx, AsyncTaskUniqueId.BROWSE, workflowId);
        logger.info(ctx, `Browse job pushed, jobid=${jobId}`);

        return workflowId;
    }

    async handleBrowse(workflowId: string) {
        await this.workflow.setWorkflowStatus(workflowId, SyncStatus.BROWSING);

        const desc = await this.workflow.getWorkflowDescription(workflowId);
        if (!desc) {
            logger.error({ workflowId }, 'Workflow description not found');
            return;
        }

        const ctx = createNewContext(desc.tenantId);
        const extractor = getExtractorBySystemType(
            ctx,
            desc.system.type,
            desc.system.uniqueIdentifier
        );

        if (!extractor) {
            logger.error(ctx, `Extractor not found for type: ${desc.system.type}`);
            return;
        }

        logger.info(ctx, 'Browsing resources');

        const browsedResources = await extractor.browse(ctx, desc.system.id);

        logger.info(ctx, `Browsed ${browsedResources.length} resources`);

        const current = await this.resourceStore.getResourceVersions(ctx, desc.system.id);

        const { deleted, outdated } = this.compareResourcesToRefresh(
            ctx,
            browsedResources,
            current
        );

        logger.info(ctx, `Found ${deleted.length} deleted, ${outdated.length} outdated`);

        await this.stageDeletedResources(ctx, deleted, desc.system, workflowId);
        await this.workflow.cacheOutdated(workflowId, outdated);

        await this.workflow.setWorkflowStatus(workflowId, SyncStatus.BROWSED);

        await this.taskq.push(ctx, AsyncTaskUniqueId.EXTRACT, workflowId);
        logger.info(ctx, 'Browse completed');
    }

    async handleExtract(workflowId: string) {
        await this.workflow.setWorkflowStatus(workflowId, SyncStatus.EXTRACTING);

        const desc = await this.workflow.getWorkflowDescription(workflowId);
        if (!desc) {
            logger.error({ workflowId }, 'Workflow description not found');
            return;
        }

        const ctx = createNewContext(desc.tenantId);
        const extractor = getExtractorBySystemType(
            ctx,
            desc.system.type,
            desc.system.uniqueIdentifier
        );

        if (!extractor) {
            logger.error(ctx, `Extractor not found for type: ${desc.system.type}`);
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

        await this.workflow.setWorkflowStatus(workflowId, SyncStatus.INGESTING);
    }

    async handleMonitorIngest(workflowIds: string[]) {
        for (let workflowId of workflowIds) {
            logger.info(`resources are ingested for workflow, workflow id=${workflowId}`);

            const desc = await this.workflow.getWorkflowDescription(workflowId);
            if (!desc) {
                logger.error({ workflowId }, 'Workflow description not found');
                return;
            }
            const ctx = createNewContext(desc.tenantId);
            const left = await this.ingest.countUningested(ctx, workflowId);
            if (left === 0) {
                await this.workflow.setWorkflowStatus(workflowId, SyncStatus.COMPLETED);
                logger.info(ctx, 'Workflow completed');
            } else {
                logger.info(ctx, `Ingest monitoring: ${left} remaining`);
            }
        }
    }

    async getWorkflowStatus(ctx: IContext, workflowId: string): Promise<ISyncAllStatus> {
        const status = await this.workflow.getWorkflowStatus(workflowId);
        if (!status) {
            return { status: SyncStatus.UNKNOWN };
        }
        return { status: status as SyncStatus };
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
}
