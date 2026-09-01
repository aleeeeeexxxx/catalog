import { createNewContext, IContext } from '../context';
import {
    IStageResource,
    Relationship,
    RelationshipDatastore,
    ResourceDatastore,
    StageDatastore,
    SystemDatastore,
} from '../infra/prisma';
import { getLogger } from '../logger';
import { Prisma } from '../../generated/prisma/client';
import { Generate32UUID } from '../utils/uuid';
import { AsyncJobService, AsyncTaskUniqueId } from './asyncJob';
import { CountAndTimerBasedNotifier, RedisClient } from '../infra';

const logger = getLogger(__filename);

const STAGE_NOTIFIER_NAME = 'stage_notifier';
const MAX_WAITING_STAGE = 50;
const DELAY = 60; // 1 min

export class IngestService {
    private stageStore: StageDatastore;
    private resourceStore: ResourceDatastore;
    private systemStore: SystemDatastore;
    private relationshipStore: RelationshipDatastore;

    private taskq: AsyncJobService;
    private notifier: CountAndTimerBasedNotifier;

    constructor(
        stageStore: StageDatastore,
        resourceStore: ResourceDatastore,
        systemStore: SystemDatastore,
        relationshipStore: RelationshipDatastore,
        taskq: AsyncJobService,
        redis: RedisClient
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
            MAX_WAITING_STAGE,
            DELAY,
            this.enqueueIngestTask.bind(this)
        );
    }

    async stage(ctx: IContext, objects: IStageResource[]): Promise<string[]> {
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
                deletedBy: obj.deletedBy,
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

    async ingest(ctx: IContext, maxStage: number): Promise<string[]> {
        const stageIds = await this.stageStore.getPendingStages(ctx, maxStage);

        if (stageIds.length === 0) {
            return [];
        }

        await this.systemStore.batchUpsertFromStage(ctx, stageIds);
        await this.resourceStore.batchUpsertStage(ctx, stageIds);
        await this.relationshipStore.batchUpsertStage(ctx, stageIds);

        await this.stageStore.delete(ctx, stageIds);
        return stageIds;
    }

    private async enqueueIngestTask() {
        const ctx = createNewContext(IngestService.name);
        await this.taskq.push(ctx, AsyncTaskUniqueId.INGEST, null);
    }

    private async asyncIngestTaskHandler(_param: any) {
        const ctx = createNewContext(IngestService.name);
        const maxStage = MAX_WAITING_STAGE + 10;

        await this.ingest(ctx, maxStage);
    }
}
