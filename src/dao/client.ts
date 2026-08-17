/*
 * @author Alex
 */

import { Prisma, PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getDatabaseUrl, IDbConfig } from './config';
import { IContext } from '../context';

export type PrismaTx = Prisma.TransactionClient;

export class TenantDbClient {
    private cfg: IDbConfig;
    private client: PrismaClient;
    private pool: Pool;

    constructor(cfg: IDbConfig) {
        this.cfg = cfg;

        this.pool = new Pool({ connectionString: getDatabaseUrl(cfg) });
        const adapter = new PrismaPg(this.pool);

        this.client = new PrismaClient({
            adapter,
        });
    }

    async connect() {
        await this.client.$connect();
    }

    async disconnect() {
        await this.client.$disconnect();
    }

    async transaction<T>(
        ctx: IContext,
        tx: Prisma.TransactionClient | undefined,
        fn: (tx: Prisma.TransactionClient) => Promise<T>
    ): Promise<T> {
        if (tx) {
            return await fn(tx);
        }

        return await this.client.$transaction(async tx => {
            // RLS -> tenant isolution
            await tx.$executeRaw`
                SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)
            `;

            return await fn(tx);
        });
    }
}
