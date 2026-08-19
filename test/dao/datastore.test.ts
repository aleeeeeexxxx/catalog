/*
 * @author Alex
 */

import { createNewContext } from '../../src/context';
import { ResourceDatastore, SystemDatastore, DbClient, StageDatastore } from '../../src/dao';
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

describe.skip('ResourceDatastore', () => {
    const ctx = createNewContext('ResourceDatastore');

    it('createOrUpdateResource', async () => {
        const result = await resources.createOrUpdateResource(ctx, {
            systemUniqueIdentifier: 'test-system-001',
            resource: {
                nativeUniqueName: 'createOrUpdateResource',
                name: 'name',
                description: 'description',
                version: '1.0',
            },
        });

        expect(result.id).toBeDefined();
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
