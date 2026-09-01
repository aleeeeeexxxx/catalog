import { createNewContext, IContext } from '../context';
import { getExtractorBySystemType, IBrowseResult, IExtractedResource } from '../extractor';
import { IStageResource, ISystem, RedisClient, ResourceDatastore, SystemDatastore } from '../infra';
import { Generate32UUID } from '../utils/uuid';
import { AsyncJobService, AsyncTaskUniqueId } from './asyncJob';
import { IngestService } from './ingest';

const errorSystemNotExist = new Error('system not exist');

export enum SyncStatus {
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

export interface ISyncAllStatus {}

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

        this.ingest = ingest;

        this.taskq = taskq;
        this.taskq.register({
            uniqueId: AsyncTaskUniqueId.BROWSE,
            handler: this.handleBrowse.bind(this),
        });
        this.taskq.register({
            uniqueId: AsyncTaskUniqueId.EXTRACT,
            handler: this.handleExtract.bind(this),
        });
    }

    async start(ctx: IContext, systemId: string): Promise<string> {
        const target = await this.systemStore.get(ctx, systemId);
        if (!target) {
            throw errorSystemNotExist;
        }

        const workflowId = await this.workflow.createNewWorkflow(
            ctx.tenantId,
            ctx.correlationId,
            target
        );

        await this.taskq.push(ctx, AsyncTaskUniqueId.BROWSE, workflowId);

        return workflowId;
    }

    async handleBrowse(workflowId: string) {
        await this.workflow.setWorkflowStatus(workflowId, SyncStatus.BROWSING);

        const desc = await this.workflow.getWorkflowDescription(workflowId);

        const ctx = createNewContext(desc.tenantId);
        const extractor = getExtractorBySystemType(
            ctx,
            desc.system.type,
            desc.system.uniqueIdentifier
        );

        if (!extractor) {
            return;
        }

        const browsedResources = await extractor.browse(ctx, desc.system.uniqueIdentifier);

        const current = await this.resourceStore.getResourceVersions(ctx);

        const { deleted, outdated } = this.compareResourcesToRefresh(
            ctx,
            browsedResources,
            current
        );

        await this.stageDeletedResources(ctx, deleted, desc.system);
        await this.workflow.cacheOutdated(workflowId, outdated);

        await this.workflow.setWorkflowStatus(workflowId, SyncStatus.BROWSED);

        await this.taskq.push(ctx, AsyncTaskUniqueId.EXTRACT, workflowId);
    }

    async handleExtract(workflowId: string) {
        await this.workflow.setWorkflowStatus(workflowId, SyncStatus.EXTRACTING);

        const desc = await this.workflow.getWorkflowDescription(workflowId);

        const ctx = createNewContext(desc.tenantId);
        const extractor = getExtractorBySystemType(
            ctx,
            desc.system.type,
            desc.system.uniqueIdentifier
        );

        if (!extractor) {
            return;
        }

        const resourceIds = await this.workflow.getOutdatedResources(workflowId);
        const resources = await extractor.extractBatch(ctx, resourceIds);

        await this.ingest.stage(ctx, mapExtractedResourceToStageResource(resources));

        await this.workflow.setWorkflowStatus(workflowId, SyncStatus.INGESTING);

        await this.taskq.push(ctx, AsyncTaskUniqueId.MONITOR_INGEST, workflowId);
    }

    async getStatus(ctx: IContext, workflowId: string): Promise<ISyncAllStatus> {
        return {};
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
}

function mapExtractedResourceToStageResource(resources: IExtractedResource[]): IStageResource[] {
    return [];
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

    constructor(redis: RedisClient) {
        this.redis = redis;
    }

    async createNewWorkflow(tenantId: string, correlationId: string, system: ISystem) {
        const workflowId = Generate32UUID();

        await this.redis.hset(
            this.statusKey(workflowId),
            SyncAllWorkflow.WORKFLOW_STATUS,
            SyncStatus.PENDING
        );
        await this.redis.hset(
            this.statusKey(workflowId),
            SyncAllWorkflow.WORKFLOW_SYSTEM,
            JSON.stringify({ tenantId, system, correlationId } as IWorkflowDescription)
        );

        return workflowId;
    }

    async setWorkflowStatus(workflowId: string, status: SyncStatus) {
        await this.redis.hset(this.statusKey(workflowId), SyncAllWorkflow.WORKFLOW_STATUS, status);
    }

    async cacheOutdated(workflowId: string, outdated: string[]) {}

    async getOutdatedResources(workflowId: string): Promise<string[]> {
        return [];
    }

    async getWorkflowDescription(workflowId: string): Promise<IWorkflowDescription> {
        throw new Error('Method not implemented.');
    }

    private statusKey(workflowId: string): string {
        return `${SyncAllWorkflow.WORKFLOW}-${workflowId}`;
    }
}
