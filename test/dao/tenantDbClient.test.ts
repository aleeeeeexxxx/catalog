import { TenantDbClient } from '../../src/dao';
import { getSharedTestContext, getTestTenantDbClient } from '../setup';

const ctx = getSharedTestContext();
let db: TenantDbClient;

describe('TenantDbClient', () => {
    beforeAll(async () => {
        db = await getTestTenantDbClient();
    });

    it('Should use tenant schema', async () => {
        await db.transaction(ctx, undefined, async tx => {
            const result = await tx.$queryRaw<Array<{ search_path: string }>>`SHOW search_path;`;

            expect(result).toBeDefined();
            expect(result[0].search_path).toEqual(``);
        });
    });
});
