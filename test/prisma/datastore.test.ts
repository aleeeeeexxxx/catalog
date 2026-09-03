/*
 * @author Alex
 */

import { createNewContext } from '../../src/context';
import {
    ResourceDatastore,
    SystemDatastore,
    DbClient,
    StageDatastore,
} from '../../src/infra/prisma';
import { getTestDbClient } from '../setup';

let dbClient: DbClient;
let resources: ResourceDatastore;
let systems: SystemDatastore;
let stage: StageDatastore;

beforeAll(async () => {
    dbClient = await getTestDbClient();

    resources = new ResourceDatastore(dbClient);
    systems = new SystemDatastore(dbClient);
    stage = new StageDatastore(dbClient);
});

afterAll(async () => {
    await dbClient.disconnect();
});

describe('SystemDatastore', () => {
    const ctx = createNewContext('SystemDatastore');

    it('curd', async () => {
        const systemId = await systems.create(ctx, {
            uniqueIdentifier: 'test-system-002',
            type: 'BTP',
        });

        expect(systemId).toBeDefined();

        const system = await systems.get(ctx, systemId);
        expect(system).toBeDefined();
        expect(system?.uniqueIdentifier).toBe('test-system-002');
        expect(system?.type).toBe('BTP');

        // soft delete
        await systems.softDelete(ctx, systemId);

        const deleted = await systems.get(ctx, systemId);
        expect(deleted).toBeNull();

        // recreate
        await systems.create(ctx, {
            uniqueIdentifier: 'test-system-002',
            type: 'BTP',
        });
    });

    it('get non-existent system', async () => {
        const system = await systems.get(ctx, 'non-existent-id');
        expect(system).toBeNull();
    });

    it('isolution', async () => {
        const ctx1 = createNewContext('SystemDatastore-1');
        const ctx2 = createNewContext('SystemDatastore-2');

        const systemId1 = await systems.create(ctx1, {
            uniqueIdentifier: 'test-system-002',
            type: 'BTP',
        });
        const systemId2 = await systems.create(ctx2, {
            uniqueIdentifier: 'test-system-002',
            type: 'BTP',
        });

        const system = await systems.get(ctx1, systemId2);
        expect(system).toBeNull();
    });
});

describe('StageDatastore', () => {
    const ctx = createNewContext('StageDatastore');
    const stageId1 = 'test-stage-001';
    const stageId2 = 'test-stage-002';

    it('stage resources, relationships and systems', async () => {
        const resources = [
            {
                stageId: stageId1,
                id: 'resource-id-001',
                tenantId: ctx.tenantId,
                nativeUniqueName: 'stage-resource-001',
                version: 1,
                systemType: 'BTP',
                systemTypeUniqueId: 'system-001',
                metadata: JSON.stringify({ name: 'Test Resource 1' }),
                startIngestAt: new Date(),
            },
            {
                stageId: stageId1,
                id: 'resource-id-002',
                tenantId: ctx.tenantId,
                nativeUniqueName: 'stage-resource-002',
                version: 1,
                systemType: 'BTP',
                systemTypeUniqueId: 'system-001',
                metadata: JSON.stringify({ name: 'Test Resource 2' }),
                startIngestAt: new Date(),
            },
            {
                stageId: stageId2,
                id: 'resource-id-003',
                tenantId: ctx.tenantId,
                nativeUniqueName: 'stage-resource-003',
                version: 2,
                systemType: 'S4',
                systemTypeUniqueId: 'system-002',
                metadata: JSON.stringify({ name: 'Test Resource 3' }),
                startIngestAt: new Date(),
            },
        ];

        const relationships = [
            {
                stageId: stageId1,
                tenantId: ctx.tenantId,
                sourceStageId: 'resource-id-001',
                targetStageId: 'resource-id-002',
                type: 'dependon',
            },
        ];

        const systems = [
            {
                stageId: stageId1,
                stageResourceId: 'resource-id-001',
                tenantId: ctx.tenantId,
                type: 'BTP',
                uniqueIdentifier: 'system-001',
            },
            {
                stageId: stageId2,
                stageResourceId: 'resource-id-003',
                tenantId: ctx.tenantId,
                type: 'S4',
                uniqueIdentifier: 'system-002',
            },
        ];

        await stage.stage(ctx, resources, relationships, systems);

        // Verify resources were created
        const stagedResources = await dbClient.prisma.stageResource.findMany({
            where: {
                stageId: { in: [stageId1, stageId2] },
            },
        });
        expect(stagedResources).toHaveLength(3);

        // Verify relationships were created
        const stagedRelationships = await dbClient.prisma.stagedRelationship.findMany({
            where: {
                stageId: stageId1,
            },
        });
        expect(stagedRelationships).toHaveLength(1);

        // Verify systems were created
        const stagedSystems = await dbClient.prisma.stagedSystem.findMany({
            where: {
                stageId: { in: [stageId1, stageId2] },
            },
        });
        expect(stagedSystems).toHaveLength(2);
    });

    it('getPendingStages', async () => {
        const stageId3 = 'test-stage-003';
        const stageId4 = 'test-stage-004';

        // Create pending stages
        await dbClient.prisma.stageResource.createMany({
            data: [
                {
                    stageId: stageId3,
                    id: 'pending-001',
                    tenantId: ctx.tenantId,
                    nativeUniqueName: 'pending-resource-001',
                    version: 1,
                    systemType: 'BTP',
                    systemTypeUniqueId: 'system-003',
                    metadata: '{}',
                    startIngestAt: null, // pending
                },
                {
                    stageId: stageId3,
                    id: 'pending-002',
                    tenantId: ctx.tenantId,
                    nativeUniqueName: 'pending-resource-002',
                    version: 1,
                    systemType: 'BTP',
                    systemTypeUniqueId: 'system-003',
                    metadata: '{}',
                    startIngestAt: null, // pending
                },
                {
                    stageId: stageId4,
                    id: 'pending-003',
                    tenantId: ctx.tenantId,
                    nativeUniqueName: 'pending-resource-003',
                    version: 1,
                    systemType: 'S4',
                    systemTypeUniqueId: 'system-004',
                    metadata: '{}',
                    startIngestAt: null, // pending
                },
            ],
        });

        // Get only 1 stageId
        const pendingStages = await stage.getPendingStages(ctx, 1);
        expect(pendingStages).toHaveLength(1);
        expect([stageId3, stageId4]).toContainEqual(pendingStages[0].stageId);

        // Verify startIngestAt was updated for the returned stageId
        const updated = await dbClient.prisma.stageResource.findMany({
            where: {
                stageId: pendingStages[0].stageId,
                startIngestAt: { not: null },
            },
        });
        expect(updated.length).toBeGreaterThan(0);
    });
});

describe('Ingest', () => {
    const ctx = createNewContext('Ingest-ResourceDatastore');

    beforeAll(async () => {
        // Create test system first
        await systems.create(ctx, {
            uniqueIdentifier: 'ingest-system-001',
            type: 'BTP',
        });
    });

    it('ingest when resource not exist', async () => {
        const stageId = 'ingest-stage-1';
        const resourceId = 'ingest-resource-1';

        await dbClient.prisma.stageResource.create({
            data: {
                stageId,
                id: resourceId,
                tenantId: ctx.tenantId,
                nativeUniqueName: 'ingest-not-exist',
                version: 1,
                systemType: 'BTP',
                systemTypeUniqueId: 'ingest-system-001',
                metadata: JSON.stringify({ name: 'new resource' }),
            },
        });

        await resources.batchUpsertStage(ctx, [stageId]);

        const rets = await dbClient.prisma.resource.findMany({
            where: {
                nativeUniqueName: 'ingest-not-exist',
                tenantId: ctx.tenantId,
                deletedAt: null,
            },
        });
        expect(rets).toHaveLength(1);
        expect(rets[0].id).toEqual(resourceId);
        expect(rets[0].version).toEqual(1);
        expect(rets[0].metadata).toEqual(JSON.stringify({ name: 'new resource' }));
    });

    it('ingest when stage ahead', async () => {
        const stageId = 'ingest-stage-2';
        const resourceId = 'ingest-resource-2';

        // Create existing resource with version 1
        const system = await dbClient.prisma.system.findFirst({
            where: {
                tenantId: ctx.tenantId,
                uniqueIdentifier: 'ingest-system-001',
                deletedAt: null,
            },
        });

        await dbClient.prisma.resource.create({
            data: {
                id: 'existing-resource-2',
                tenantId: ctx.tenantId,
                systemId: system!.id,
                nativeUniqueName: 'ingest-ahead',
                version: 1,
                metadata: JSON.stringify({ name: 'old' }),
            },
        });

        // Create stage with version 3 (ahead)
        await dbClient.prisma.stageResource.create({
            data: {
                stageId,
                id: resourceId,
                tenantId: ctx.tenantId,
                nativeUniqueName: 'ingest-ahead',
                version: 3,
                systemType: 'BTP',
                systemTypeUniqueId: 'ingest-system-001',
                metadata: JSON.stringify({ name: 'new' }),
            },
        });

        await resources.batchUpsertStage(ctx, [stageId]);

        const ret = await dbClient.prisma.resource.findFirst({
            where: {
                nativeUniqueName: 'ingest-ahead',
                tenantId: ctx.tenantId,
                deletedAt: null,
            },
        });
        expect(ret).toBeDefined();
        expect(ret?.version).toEqual(3);
        expect(ret?.metadata).toEqual(JSON.stringify({ name: 'new' }));
    });

    it('do not ingest when stage outdate', async () => {
        const stageId = 'ingest-stage-3';
        const resourceId = 'ingest-resource-3';

        const system = await dbClient.prisma.system.findFirst({
            where: {
                tenantId: ctx.tenantId,
                uniqueIdentifier: 'ingest-system-001',
                deletedAt: null,
            },
        });

        // Create existing resource with version 9
        await dbClient.prisma.resource.create({
            data: {
                id: 'existing-resource-3',
                tenantId: ctx.tenantId,
                systemId: system!.id,
                nativeUniqueName: 'ingest-outdate',
                version: 9,
                metadata: JSON.stringify({ name: 'old' }),
            },
        });

        // Create stage with version 3 (outdated)
        await dbClient.prisma.stageResource.create({
            data: {
                stageId,
                id: resourceId,
                tenantId: ctx.tenantId,
                nativeUniqueName: 'ingest-outdate',
                version: 3,
                systemType: 'BTP',
                systemTypeUniqueId: 'ingest-system-001',
                metadata: JSON.stringify({ name: 'new' }),
            },
        });

        await resources.batchUpsertStage(ctx, [stageId]);

        const ret = await dbClient.prisma.resource.findFirst({
            where: {
                nativeUniqueName: 'ingest-outdate',
                tenantId: ctx.tenantId,
                deletedAt: null,
            },
        });
        expect(ret).toBeDefined();
        expect(ret?.version).toEqual(9); // Should still be old version
        expect(ret?.metadata).toEqual(JSON.stringify({ name: 'old' }));
    });

    it('ingest when resource is deleted and stage is ahead', async () => {
        const stageId = 'ingest-stage-4';
        const resourceId = 'ingest-resource-4';

        const system = await dbClient.prisma.system.findFirst({
            where: {
                tenantId: ctx.tenantId,
                uniqueIdentifier: 'ingest-system-001',
                deletedAt: null,
            },
        });

        // Create deleted resource with version 1
        await dbClient.prisma.resource.create({
            data: {
                id: 'existing-resource-4',
                tenantId: ctx.tenantId,
                systemId: system!.id,
                nativeUniqueName: 'ingest-deleted',
                version: 1,
                metadata: JSON.stringify({ name: 'old' }),
                deletedAt: new Date(),
            },
        });

        // Create stage with version 3 (ahead)
        await dbClient.prisma.stageResource.create({
            data: {
                stageId,
                id: resourceId,
                tenantId: ctx.tenantId,
                nativeUniqueName: 'ingest-deleted',
                version: 3,
                systemType: 'BTP',
                systemTypeUniqueId: 'ingest-system-001',
                metadata: JSON.stringify({ name: 'new' }),
            },
        });

        await resources.batchUpsertStage(ctx, [stageId]);

        // Old deleted resource should still be deleted
        const old = await dbClient.prisma.resource.findFirst({
            where: {
                id: 'existing-resource-4',
                tenantId: ctx.tenantId,
            },
        });
        expect(old?.deletedAt).not.toBeNull();

        // New resource should be created
        const ret = await dbClient.prisma.resource.findFirst({
            where: {
                id: resourceId,
                tenantId: ctx.tenantId,
                deletedAt: null,
            },
        });
        expect(ret).toBeDefined();
        expect(ret?.version).toEqual(3);
        expect(ret?.metadata).toEqual(JSON.stringify({ name: 'new' }));
    });

    it('ingest with deletedBy should soft delete resource', async () => {
        const stageId = 'ingest-stage-5';
        const resourceId = 'ingest-resource-5';

        const system = await dbClient.prisma.system.findFirst({
            where: {
                tenantId: ctx.tenantId,
                uniqueIdentifier: 'ingest-system-001',
                deletedAt: null,
            },
        });

        // Create existing resource
        await dbClient.prisma.resource.create({
            data: {
                id: resourceId,
                tenantId: ctx.tenantId,
                systemId: system!.id,
                nativeUniqueName: 'ingest-to-delete',
                version: 1,
                metadata: JSON.stringify({ name: 'old' }),
            },
        });

        // Create stage with deletedBy
        await dbClient.prisma.stageResource.create({
            data: {
                stageId,
                id: resourceId,
                tenantId: ctx.tenantId,
                nativeUniqueName: 'ingest-to-delete',
                version: 3,
                systemType: 'BTP',
                systemTypeUniqueId: 'ingest-system-001',
                metadata: JSON.stringify({ name: 'new' }),
                deletedBy: 'Auto',
            },
        });

        await resources.batchUpsertStage(ctx, [stageId]);

        const ret = await dbClient.prisma.resource.findFirst({
            where: {
                id: resourceId,
                tenantId: ctx.tenantId,
            },
        });
        expect(ret).toBeDefined();
        expect(ret?.deletedAt).not.toBeNull();
        expect(ret?.deletedBy).toEqual('Auto');
    });
});
