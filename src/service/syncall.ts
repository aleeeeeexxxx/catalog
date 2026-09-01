import { createNewContext, IContext } from '../context';
import { getExtractorBySystemType, IBrowseResult, IExtractedResource } from '../extractor';
import { IStageResource, ISystem, RedisClient, ResourceDatastore, SystemDatastore } from '../infra';
import { getLogger } from '../logger';
import { SECOND } from '../utils/time';
import { Generate32UUID } from '../utils/uuid';
import { AsyncJobService, AsyncTaskUniqueId } from './asyncJob';
import { IngestService } from './ingest';

const logger = getLogger(__filename);

const errorSystemNotExist = new Error('system not exist');

export enum SyncStatus {
    UNKNOWN = 'unknown',
    PENDING = 'pending',
    BROWSING = 'browsing',
    BROWSED = 'browse completed',
    EXTRACTING = 'extracting',
    STAGED = 'staged',
    INGESTING = 'ingesting',
    COMPLETED = 'completed',
}

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
            uniqueId: AsyncTaskUniqueId.INGEST,
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

        logger.info(ctx, `Workflow created: ${workflowId}`);

        const jobId = await this.taskq.push(ctx, AsyncTaskUniqueId.BROWSE, workflowId);
        logger.info(ctx, `Browse job pushed: ${jobId}`);

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

        const browsedResources = await extractor.browse(ctx, desc.system.uniqueIdentifier);

        logger.info(ctx, `Browsed ${browsedResources.length} resources`);

        const current = await this.resourceStore.getResourceVersions(ctx);

        const { deleted, outdated } = this.compareResourcesToRefresh(
            ctx,
            browsedResources,
            current
        );

        logger.info(ctx, `Found ${deleted.length} deleted, ${outdated.length} outdated`);

        await this.stageDeletedResources(ctx, deleted, desc.system);
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
            mapExtractedResourceToStageResource(resources, ctx.tenantId, workflowId)
        );

        logger.info(ctx, 'Extract completed');
    }

    async handleMonitorIngest(workflowIds: string[]) {
        for (let workflowId in workflowIds) {
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
        resources: IBrowseResult[],
        current: IBrowseResult[]
    ): { deleted: IBrowseResult[]; outdated: string[] } {
        const deleted: IBrowseResult[] = [];
        const outdated: string[] = [];

        const currentMap = new Map();
        current.forEach(res => {
            currentMap.set(res.nativeUniqueName, res.version);
        });

        const browsedResources = new Map();
        resources.forEach(res => {
            browsedResources.set(res.nativeUniqueName, res.version);

            const cur = currentMap.get(res.nativeUniqueName);
            if (cur && cur.version >= res.version) {
                return;
            }
            outdated.push(res.nativeUniqueName);
        });

        current.forEach(res => {
            const browsed = browsedResources.get(res.nativeUniqueName);
            if (!browsed) {
                deleted.push(res);
            }
        });

        return { deleted, outdated };
    }

    private async stageDeletedResources(ctx: IContext, deleted: IBrowseResult[], system: ISystem) {
        const stageDeleted: IStageResource[] = deleted.map(res => {
            return {
                tenantId: ctx.tenantId,
                nativeUniqueName: res.nativeUniqueName,
                version: res.version,
                deletedBy: 'auto',
                system,
                metadata: '',
            };
        });
        await this.ingest.stage(ctx, stageDeleted);
    }

    private async createMonitorIngestTask(workflowIds: string[]) {
        const ctx = createNewContext('createMonitorIngestTask');
        await this.taskq.push(ctx, AsyncTaskUniqueId.MONITOR_INGEST, workflowIds);
    }
}

function mapExtractedResourceToStageResource(
    resources: IExtractedResource[],
    tenantId: string,
    workflowId: string
): IStageResource[] {
    return resources.map(extracted => {
        const resource: IStageResource = {
            workflowId,
            tenantId,
            nativeUniqueName: extracted.metadata.resource.nativeUniqueName,
            version: extracted.metadata.resource.version,
            system: extracted.metadata.system,
            metadata: extracted.metadata.resource.metadata,
        };

        if (extracted.parents && extracted.parents.length > 0) {
            resource.parents = extracted.parents.map(parent => ({
                tenantId,
                nativeUniqueName: parent.resource.nativeUniqueName,
                version: parent.resource.version,
                system: parent.system,
                metadata: parent.resource.metadata,
            }));
        }

        if (extracted.children && extracted.children.length > 0) {
            resource.children = extracted.children.map(child => ({
                tenantId,
                nativeUniqueName: child.resource.nativeUniqueName,
                version: child.resource.version,
                system: child.system,
                metadata: child.resource.metadata,
            }));
        }

        return resource;
    });
}

interface IWorkflowDescription {
    tenantId: string;
    system: ISystem;
    correlationId: string;
}

class SyncAllWorkflow {
    private redis: RedisClient;

    static WORKFLOW = 'sync_all_workflow';
    static WORKFLOW_STATUS = 'status';
    static WORKFLOW_SYSTEM = 'system';
    static WORKFLOW_OUTDATED = 'resources';

    static PENDING_OUTDATED_RESOURCE_SCORE = 10;

    constructor(redis: RedisClient) {
        this.redis = redis;
    }

    async createNewWorkflow(
        tenantId: string,
        correlationId: string,
        system: ISystem
    ): Promise<string> {
        const workflowId = Generate32UUID();

        const pipeline = this.redis.pipeline();

        pipeline.set(this.key(SyncAllWorkflow.WORKFLOW_STATUS, workflowId), SyncStatus.PENDING);
        pipeline.set(
            this.key(SyncAllWorkflow.WORKFLOW_SYSTEM, workflowId),
            JSON.stringify({ tenantId, system, correlationId } as IWorkflowDescription)
        );

        await pipeline.exec();

        return workflowId;
    }

    async setWorkflowStatus(workflowId: string, status: SyncStatus) {
        await this.redis.set(this.key(SyncAllWorkflow.WORKFLOW_STATUS, workflowId), status);
    }

    async getWorkflowStatus(workflowId: string) {
        return await this.redis.get(this.key(SyncAllWorkflow.WORKFLOW_STATUS, workflowId));
    }

    async cacheOutdated(workflowId: string, outdated: string[]) {
        const param: (number | string)[] = [];
        outdated.forEach(item => {
            param.push(SyncAllWorkflow.PENDING_OUTDATED_RESOURCE_SCORE, item);
        });

        await this.redis.zadd(this.key(SyncAllWorkflow.WORKFLOW_OUTDATED, workflowId), ...param);
    }

    async getOutdatedResources(workflowId: string): Promise<string[]> {
        return await this.redis.zrangebyscore(
            this.key(SyncAllWorkflow.WORKFLOW_OUTDATED, workflowId),
            SyncAllWorkflow.PENDING_OUTDATED_RESOURCE_SCORE - 1,
            SyncAllWorkflow.PENDING_OUTDATED_RESOURCE_SCORE + 1
        );
    }

    async getWorkflowDescription(workflowId: string): Promise<IWorkflowDescription | null> {
        const system = await this.redis.get(this.key(SyncAllWorkflow.WORKFLOW_SYSTEM, workflowId));
        if (!system) {
            return null;
        }

        return JSON.parse(system);
    }

    private key(prefix: string, workflowId: string): string {
        return `workflow/${prefix}-${workflowId}`;
    }
}
