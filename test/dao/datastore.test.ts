/*
 * @author Alex
 */

import { Prisma } from '../../generated/prisma/client';
import { createNewContext } from '../../src/context';
import {
    ResourceDatastore,
    SystemDatastore,
    DbClient,
    StageDatastore,
    IResourceToUpdate,
    IStageResource,
    IStage,
    IResource,
} from '../../src/dao';
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

describe('ResourceDatastore', () => {
    const ctx = createNewContext('ResourceDatastore');

    it('createOrUpdateResource', async () => {
        const result = await resources.createOrUpdateResource(ctx, {
            systemUniqueIdentifier: 'system-not-exist',
            resource: {
                nativeUniqueName: 'createOrUpdateResource',
                name: 'name',
                description: 'description',
                version: '1.0',
            },
        });

        expect(result.id).toBeUndefined();
    });
});

describe('SystemDatastore', () => {
    const ctx = createNewContext('SystemDatastore');

    it('create and get', async () => {
        const systemId = await systems.create(ctx, {
            uniqueIdentifier: 'test-system-002',
            type: 'BTP',
        });

        expect(systemId).toBeDefined();

        const system = await systems.get(ctx, systemId);
        expect(system).toBeDefined();
        expect(system?.uniqueIdentifier).toBe('test-system-002');
        expect(system?.type).toBe('BTP');
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

    it('stage', async () => {
        const resources = [
            {
                tenantId: 't1',
                systemId: 'test-system-id-001',
                nativeUniqueName: 'stage-resource-001',
                version: '1.0',
                resource: {
                    name: 'Test Resource 1',
                    description: 'Description for test resource 1',
                },
            },
            {
                tenantId: 't2',
                systemId: 'test-system-id-002',
                nativeUniqueName: 'stage-resource-002',
                version: '1.1',
                resource: {
                    name: 'Test Resource 2',
                    description: 'Description for test resource 2',
                },
            },
            {
                tenantId: 't3',
                systemId: 'test-system-id-003',
                nativeUniqueName: 'stage-resource-003',
                version: '2.0',
                resource: {
                    name: 'Test Resource 3',
                    description: 'Description for test resource 3',
                },
            },
            {
                tenantId: 't4',
                systemId: 'test-system-id-004',
                nativeUniqueName: 'stage-resource-004',
                version: '2.5',
                resource: {
                    name: 'Test Resource 4',
                    description: 'Description for test resource 4',
                },
            },
        ];

        const ids = await stage.stage(ctx, resources);
        expect(ids).toHaveLength(4);

        const targets = await stage.listStages(ctx, ids[1], 2);
        expect(targets).toHaveLength(2);
        expect(targets[0]).toEqual(ids[2]);
        expect(targets[1]).toEqual(ids[3]);

        await stage.delete(ctx, targets);
        const deleted = await stage.listStages(ctx, ids[1], 2);
        expect(deleted).toHaveLength(0);
    });
});

describe('Ingest', () => {
    const ctx = createNewContext('Ingest-ResourceDatastore');

    it('ingest when resource not exist', async () => {
        await dbClient.prisma.stage.create({
            data: {
                id: 'stage-1',
                version: '1',
                tenantId: 'Ingest-ResourceDatastore',
                systemId: 'system',
                nativeUniqueName: 'ingest-not-exist',
            },
        });
        await dbClient.prisma.stagedResource.create({
            data: {
                stageId: 'stage-1',
                name: 'old',
                desc: 'old',
            },
        });

        await resources.batchUpsertStage(ctx, ['stage-1']);

        const rets = await dbClient.prisma.resource.findMany({
            where: {
                nativeUniqueName: {
                    equals: 'ingest-not-exist',
                },
                deletedAt: null,
            },
        });
        expect(rets).toHaveLength(1);

        expect(rets[0].id).toEqual('stage-1');
        expect(rets[0].name).toEqual('old');
        expect(rets[0].desc).toEqual('old');
        expect(rets[0].version).toEqual('1');
        expect(rets[0].tenantId).toEqual('Ingest-ResourceDatastore');
        expect(rets[0].systemId).toEqual('system');
        expect(rets[0].nativeUniqueName).toEqual('ingest-not-exist');
    });

    it('ingest when stage ahead', async () => {
        await dbClient.prisma.resource.create({
            data: {
                id: 'ingest-ahead',
                version: '1',
                tenantId: 'Ingest-ResourceDatastore',
                systemId: 'system',
                nativeUniqueName: 'ingest-ahead',
                name: '',
                desc: 'old',
            },
        });

        await dbClient.prisma.stage.create({
            data: {
                id: 'stage-2',
                version: '3',
                tenantId: 'Ingest-ResourceDatastore',
                systemId: 'system',
                nativeUniqueName: 'ingest-ahead',
            },
        });
        await dbClient.prisma.stagedResource.create({
            data: {
                stageId: 'stage-2',
                name: '',
                desc: 'new',
            },
        });

        await resources.batchUpsertStage(ctx, ['stage-2']);

        const ret = await resources.getResource(ctx, 'ingest-ahead');
        expect(ret).toBeDefined();
        expect(ret?.description).toEqual('new');
    });

    it('do not ingest when stage outdate', async () => {
        await dbClient.prisma.resource.create({
            data: {
                id: 'ingest-outdate',
                version: '9',
                tenantId: 'Ingest-ResourceDatastore',
                systemId: 'system',
                nativeUniqueName: 'ingest-outdate',
                name: '',
                desc: 'old',
            },
        });

        await dbClient.prisma.stage.create({
            data: {
                id: 'stage-3',
                version: '3',
                tenantId: 'Ingest-ResourceDatastore',
                systemId: 'system',
                nativeUniqueName: 'ingest-outdate',
            },
        });
        await dbClient.prisma.stagedResource.create({
            data: {
                stageId: 'stage-3',
                name: '',
                desc: 'new',
            },
        });

        await resources.batchUpsertStage(ctx, ['stage-3']);

        const ret = await resources.getResource(ctx, 'ingest-outdate');
        expect(ret).toBeDefined();
        expect(ret?.description).toEqual('old');
    });

    it('ingest when resource is deleted and stage is ahead', async () => {
        await dbClient.prisma.resource.create({
            data: {
                id: 'ingest-deleted',
                version: '1',
                tenantId: 'Ingest-ResourceDatastore',
                systemId: 'system',
                nativeUniqueName: 'ingest-deleted',
                name: '',
                desc: 'old',
                deletedAt: new Date(),
            },
        });

        await dbClient.prisma.stage.create({
            data: {
                id: 'stage-4',
                version: '3',
                tenantId: 'Ingest-ResourceDatastore',
                systemId: 'system',
                nativeUniqueName: 'ingest-deleted',
            },
        });
        await dbClient.prisma.stagedResource.create({
            data: {
                stageId: 'stage-4',
                name: '',
                desc: 'new',
            },
        });

        await resources.batchUpsertStage(ctx, ['stage-4']);

        const old = await resources.getResource(ctx, 'ingest-deleted');
        expect(old).toBeNull();

        const ret = await resources.getResource(ctx, 'stage-4');
        expect(ret?.description).toEqual('new');
    });

    it('do not ingest when resource is deleted and stage is outdate', async () => {
        await dbClient.prisma.resource.create({
            data: {
                id: 'ingest-deleted-outdate',
                version: '9',
                tenantId: 'Ingest-ResourceDatastore',
                systemId: 'system',
                nativeUniqueName: 'ingest-deleted-outdate',
                name: '',
                desc: 'old',
                deletedAt: new Date(),
            },
        });

        await dbClient.prisma.stage.create({
            data: {
                id: 'stage-5',
                version: '3',
                tenantId: 'Ingest-ResourceDatastore',
                systemId: 'system',
                nativeUniqueName: 'ingest-deleted-outdate',
            },
        });
        await dbClient.prisma.stagedResource.create({
            data: {
                stageId: 'stage-5',
                name: '',
                desc: 'new',
            },
        });

        await resources.batchUpsertStage(ctx, ['stage-5']);

        const old = await resources.getResource(ctx, 'ingest-deleted-outdate');
        expect(old).toBeNull();

        const ret = await resources.getResource(ctx, 'stage-5');
        expect(ret).toBeNull();
    });

    it('ingest when delete', async () => {
        await dbClient.prisma.resource.create({
            data: {
                id: 'ingest-when-deleted',
                version: '1',
                tenantId: 'Ingest-ResourceDatastore',
                systemId: 'system',
                nativeUniqueName: 'ingest-when-deleted',
                name: '',
                desc: 'old',
            },
        });

        await dbClient.prisma.stage.create({
            data: {
                id: 'stage-6',
                version: '3',
                tenantId: 'Ingest-ResourceDatastore',
                systemId: 'system',
                nativeUniqueName: 'ingest-when-deleted',
                deletedBy: 'Auto',
            },
        });
        await dbClient.prisma.stagedResource.create({
            data: {
                stageId: 'stage-6',
                name: '',
                desc: 'new',
            },
        });

        await resources.batchUpsertStage(ctx, ['stage-6']);

        const old = await resources.getResource(ctx, 'ingest-when-deleted');
        expect(old).toBeNull();

        const ret = await resources.getResource(ctx, 'stage-6');
        expect(ret).toBeNull();
    });
});
