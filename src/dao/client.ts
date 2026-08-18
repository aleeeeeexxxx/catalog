/*
 * @author Alex
 */

import { Prisma, PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getDatabaseUrl, IDbConfig } from './config';
import { IContext } from '../context';
import { getLogger } from '../logger';

const logger = getLogger(__filename);

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
            log: [{ level: 'query', emit: 'event' }],
        });
        this.initLogger();
    }

    async connect() {
        await this.client.$connect();
    }

    async disconnect() {
        await this.pool.end();
        await this.client.$disconnect();
    }

    async transaction<T>(
        ctx: IContext,
        fn: (tx: Prisma.TransactionClient) => Promise<T>,
        tx?: Prisma.TransactionClient
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

    private initLogger() {
        this.client.$on('query' as never, (ev: Prisma.QueryEvent) => {
            logger.debug(`Query: ${ev.query} | Params: ${ev.params} | Duration: ${ev.duration}ms`);
        });
    }
}
