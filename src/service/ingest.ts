import { IContext } from '../context';
import {
    IStageResource,
    Relationship,
    RelationshipDatastore,
    ResourceDatastore,
    StageDatastore,
    SystemDatastore,
    VERSION_REFERENCED_ONLY,
} from '../infra/prisma';
import { getLogger } from '../logger';
import { Prisma } from '../../generated/prisma/client';
import { Generate32UUID } from '../utils/uuid';

const logger = getLogger(__filename);

export class Ingest {
    private stageStore: StageDatastore;
    private resourceStore: ResourceDatastore;
    private systemStore: SystemDatastore;
    private relationshipStore: RelationshipDatastore;

    constructor(
        stageStore: StageDatastore,
        resourceStore: ResourceDatastore,
        systemStore: SystemDatastore,
        relationshipStore: RelationshipDatastore
    ) {
        this.stageStore = stageStore;
        this.resourceStore = resourceStore;
        this.systemStore = systemStore;
        this.relationshipStore = relationshipStore;
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
            });

            enqueueSystem({
                stageId,
                stageResourceId: id,
                tenantId: obj.tenantId,
                type: obj.system.type,
                uniqueIdentifier: obj.system.uniqueIdentifier,
            });

            obj.parents.forEach(parent => {
                const parentId = Generate32UUID();

                resources.push({
                    id: parentId,
                    stageId,
                    tenantId: obj.tenantId,
                    nativeUniqueName: parent.nativeUniqueName,
                    version: VERSION_REFERENCED_ONLY,
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

            obj.children.forEach(child => {
                const childId = Generate32UUID();

                resources.push({
                    id: childId,
                    stageId,
                    tenantId: obj.tenantId,
                    nativeUniqueName: child.nativeUniqueName,
                    version: VERSION_REFERENCED_ONLY,
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
}
