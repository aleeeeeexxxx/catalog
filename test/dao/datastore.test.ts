/*
 * @author Alex
 */

import { ResourceDatastore, SystemDatastore, TenantDbClient, StageDatastore } from '../../src/dao';
import { getSharedTestContext, getTestTenantDbClient } from '../setup';

const ctx = getSharedTestContext();
let dbClient: TenantDbClient;
let resources: ResourceDatastore;
let systems: SystemDatastore;
let stage: StageDatastore;

beforeAll(async () => {
    dbClient = await getTestTenantDbClient();

    resources = new ResourceDatastore(dbClient);
    systems = new SystemDatastore(dbClient);
    stage = new StageDatastore(dbClient);
});

afterAll(async () => {
    await dbClient.disconnect();
});

describe.skip('ResourceDatastore', () => {
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
    it('create', async () => {
        const systemId = await systems.create(ctx, {
            uniqueIdentifier: 'test-system-001',
            type: 'S4HANA',
            connection: 'https://test.example.com:443',
        });

        expect(systemId).toBeDefined();
        expect(typeof systemId).toBe('string');
    });

    it('get', async () => {
        const systemId = await systems.create(ctx, {
            uniqueIdentifier: 'test-system-002',
            type: 'BTP',
            connection: 'https://btp.example.com',
        });

        const system = await systems.get(ctx, systemId);

        expect(system).toBeDefined();
        expect(system?.uniqueIdentifier).toBe('test-system-002');
        expect(system?.type).toBe('BTP');
        expect(system?.connection).toBe('https://btp.example.com');
    });

    it('get non-existent system', async () => {
        const system = await systems.get(ctx, 'non-existent-id');

        expect(system).toBeNull();
    });
});

describe('StageDatastore', () => {
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
