/*
 * @author Alex
 */

import { ResourceDatastore, SystemDatastore, TenantDbClient } from '../../src/dao';
import { getSharedTestContext, getTestTenantDbClient } from '../setup';

const ctx = getSharedTestContext();
let dbClient: TenantDbClient;
let resources: ResourceDatastore;
let systems: SystemDatastore;

beforeAll(async () => {
    dbClient = await getTestTenantDbClient();
    resources = new ResourceDatastore(dbClient);
    systems = new SystemDatastore(dbClient);
});

afterAll(async () => {
    await dbClient.disconnect();
});

describe('ResourceDatastore', () => {
    it.skip('createOrUpdateResource', async () => {
        const result = await resources.createOrUpdateResource(ctx, {
            systemUniqueIdentifier: 'test-system',
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
