import * as config from '../../dev/db.config.json';
import { IContext } from '../context';
import { TenantDbClient } from './client';
import { IDbConfig } from './config';

export const db = new TenantDbClient(config as unknown as IDbConfig);

beforeAll(async () => {
    await db.client.$connect();
});

afterAll(async () => {
    await db.client.$disconnect();
});

describe('TenantDbClient', () => {
    it('Connect', async () => {
        const ctx = {} as IContext;

        await db.transaction(ctx, undefined, async tx => {
            const result = await tx.$queryRaw<Array<{ search_path: string }>>`SHOW search_path;`;

            expect(result).toBeDefined();
            expect(result[0].search_path).toEqual('"$user", public');
        });
    });
});
