import { createNewContext, IContext } from '../context';
import {
    IStageResource,
    Relationship,
    RelationshipDatastore,
    ResourceDatastore,
    StageDatastore,
    SystemDatastore,
} from '../dao/prisma';
import { getLogger } from '../logger';
import { Prisma } from '../../generated/prisma/client';
import { Generate32UUID } from '../utils/uuid';
import { AsyncJobService, AsyncTaskUniqueId } from './asyncJob';
import { CountAndTimerBasedNotifier, RedisClient } from '../dao';

const logger = getLogger(__filename);

const STAGE_NOTIFIER_TOPIC = 'stage_notifier_topic';
const STAGE_NOTIFIER_NAME = 'stage_notifier';
const MAX_WAITING_STAGE = 50;
const DELAY = 60; // 1 min

export type IngestCallback = (ingestedWorkflowIds: string[]) => Promise<void>;

export class IngestService {
    private stageStore: StageDatastore;
    private resourceStore: ResourceDatastore;
    private systemStore: SystemDatastore;
    private relationshipStore: RelationshipDatastore;

    private taskq: AsyncJobService;
    private notifier: CountAndTimerBasedNotifier;

    private ingestCallback: IngestCallback | undefined;

    constructor(
        stageStore: StageDatastore,
        resourceStore: ResourceDatastore,
        systemStore: SystemDatastore,
        relationshipStore: RelationshipDatastore,
        taskq: AsyncJobService,
        redis: RedisClient,
        maxWaitingStage: number = MAX_WAITING_STAGE,
        stageNotifyDelay: number = DELAY
    ) {
        this.stageStore = stageStore;
        this.resourceStore = resourceStore;
        this.systemStore = systemStore;
        this.relationshipStore = relationshipStore;

        this.taskq = taskq;
        this.taskq.register({
            uniqueId: AsyncTaskUniqueId.INGEST,
            handler: this.asyncIngestTaskHandler.bind(this),
        });

        this.notifier = new CountAndTimerBasedNotifier(
            redis,
            maxWaitingStage,
            stageNotifyDelay,
            this.enqueueIngestTask.bind(this),
            STAGE_NOTIFIER_TOPIC
        );
    }

    setIngestCallback(callback: IngestCallback) {
        if (this.ingestCallback) {
            throw new Error('Ingest callback has already been set');
        }
        this.ingestCallback = callback;
    }

    async stage(ctx: IContext, objects: IStageResource[]): Promise<string[]> {
        logger.info(ctx, `staging resources, length=${objects.length}`);

        const stageIds: string[] = [];

        const resources: Prisma.StageResourceCreateManyInput[] = [];
        const relationship: Prisma.StagedRelationshipCreateManyInput[] = [];

        const systems: Prisma.StagedSystemCreateManyInput[] = [];
        const systemsDedup: Set<string> = new Set();
        const enqueueSystem = (item: Prisma.StagedSystemCreateManyInput) => {
            const key = `${item.tenantId}-${item.type}-${item.uniqueIdentifier}`;
            if (systemsDedup.has(key)) {
                return;
            }

            systemsDedup.add(key);
            systems.push(item);
        };

        objects.forEach(obj => {
            const id = Generate32UUID();
            const stageId = id;
            stageIds.push(stageId);

            resources.push({
                id,
                stageId,
                tenantId: obj.tenantId,
                nativeUniqueName: obj.nativeUniqueName,
                version: obj.version,
                metadata: JSON.stringify(obj.metadata),
                systemType: obj.system.type,
                systemTypeUniqueId: obj.system.uniqueIdentifier,
                deletedAt: obj.deletedAt,
                workflowId: obj.workflowId,
            });

            enqueueSystem({
                stageId,
                stageResourceId: id,
                tenantId: obj.tenantId,
                type: obj.system.type,
                uniqueIdentifier: obj.system.uniqueIdentifier,
            });

            obj.parents?.forEach(parent => {
                const parentId = Generate32UUID();

                resources.push({
                    id: parentId,
                    stageId,
                    tenantId: obj.tenantId,
                    nativeUniqueName: parent.nativeUniqueName,
                    version: parent.version,
                    metadata: JSON.stringify(parent.metadata),
                    systemType: parent.system.type,
                    systemTypeUniqueId: parent.system.uniqueIdentifier,
                    workflowId: obj.workflowId,
                });

                enqueueSystem({
                    stageId,
                    stageResourceId: parentId,
                    tenantId: obj.tenantId,
                    type: parent.system.type,
                    uniqueIdentifier: parent.system.uniqueIdentifier,
                });

                relationship.push({
                    stageId,
                    tenantId: obj.tenantId,
                    sourceStageId: id,
                    targetStageId: parentId,
                    type: Relationship.dependon,
                });
            });

            obj.children?.forEach(child => {
                const childId = Generate32UUID();

                resources.push({
                    id: childId,
                    stageId,
                    tenantId: obj.tenantId,
                    nativeUniqueName: child.nativeUniqueName,
                    version: child.version,
                    metadata: JSON.stringify(child.metadata),
                    systemType: child.system.type,
                    systemTypeUniqueId: child.system.uniqueIdentifier,
                    workflowId: obj.workflowId,
                });

                enqueueSystem({
                    stageId,
                    stageResourceId: childId,
                    tenantId: obj.tenantId,
                    type: child.system.type,
                    uniqueIdentifier: child.system.uniqueIdentifier,
                });

                relationship.push({
                    stageId,
                    tenantId: obj.tenantId,
                    sourceStageId: childId,
                    targetStageId: id,
                    type: Relationship.dependon,
                });
            });
        });

        await this.stageStore.stage(ctx, resources, relationship, systems);
        await this.notifier.add(STAGE_NOTIFIER_NAME, objects.length);

        return stageIds;
    }

    async ingest(ctx: IContext, maxStage: number) {
        logger.info(ctx, `Ingesting resources, maxStage=${maxStage}`);
        const stages = await this.stageStore.getPendingStages(ctx, maxStage);

        const stageIds = stages.map(stage => stage.stageId);
        logger.debug(ctx, `Pending stage resources, stagedIds=${JSON.stringify(stageIds)}`);
        if (stageIds.length === 0) {
            logger.info(ctx, `No staged resources got, skip ingesting`);
            return [];
        }

        logger.info(
            ctx,
            `Staged resources to ingest, length=${stageIds.length}, stagedIds=${JSON.stringify(stageIds)}`
        );

        await this.systemStore.batchUpsertFromStage(ctx, stageIds);
        await this.resourceStore.batchUpsertStage(ctx, stageIds);
        await this.relationshipStore.batchUpsertStage(ctx, stageIds);

        await this.stageStore.delete(ctx, stageIds);

        if (this.ingestCallback) {
            const workflowIds = new Set<string>();
            stages.forEach(stage => {
                if (stage.workflowId) {
                    workflowIds.add(stage.workflowId);
                }
            });

            void this.ingestCallback(Array.from(workflowIds));
        }
    }

    async countUningested(ctx: IContext, workflowId: string): Promise<number> {
        return this.stageStore.countStagesByWorkflowId(ctx, workflowId);
    }

    private async enqueueIngestTask() {
        const ctx = createNewContext(IngestService.name);
        logger.debug(ctx, `enqueue ingest task`);

        await this.taskq.push(ctx, AsyncTaskUniqueId.INGEST, null);
    }

    private async asyncIngestTaskHandler(_param: any) {
        const ctx = createNewContext(IngestService.name);
        const maxStage = MAX_WAITING_STAGE + 10;

        await this.ingest(ctx, maxStage);
    }
}
