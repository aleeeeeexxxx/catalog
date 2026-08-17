import { IContext } from '../../src/context';
import { SystemDatastore, TenantDbClient } from '../../src/dao';
import { getSharedTestContext, getTestTenantDbClient } from '../setup';

let dbClient: TenantDbClient;

describe('TenantDbClient', () => {
    beforeAll(async () => {
        dbClient = await getTestTenantDbClient();
    });

    it('tenant isolution', async () => {
        const ctx1: IContext = {
            tenantId: 'tenant-1',
            correlationId: 'correlationId',
        };
        const ctx2: IContext = {
            tenantId: 'tenant-2',
            correlationId: 'correlationId',
        };
        const systems = new SystemDatastore(dbClient);

        const id = await systems.create(ctx1, {
            uniqueIdentifier: 'tenant isolution',
            type: 'type',
            connection: 'connection',
        });

        const ret = await systems.get(ctx2, id);
        expect(ret).toBeNull();
    });
});
