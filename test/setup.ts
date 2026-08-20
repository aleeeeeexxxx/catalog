import { DbClient } from '../src/dao/client';
import { IDbConfig } from '../src/dao/config';
import { Once } from '../src/utils/once';
import { getLogger } from '../src/logger';
import { createNewContext, IContext } from '../src/context';
import { v4 as uuidv4 } from 'uuid';

const logger = getLogger(__filename);

function loadDevDbConfig(): IDbConfig {
    const config = require('../dev/db.config.json');
    return {
        host: config.host,
        port: parseInt(config.port, 10),
        user: config.user,
        password: config.password,
        database: config.database,
    };
}

async function createTestDbClient(): Promise<DbClient> {
    logger.info('Creating test tenant DB client');

    const cfg = loadDevDbConfig();
    logger.info(`Loaded DB config: ${cfg.host}:${cfg.port}/${cfg.database || 'catalog'}`);

    const db = new DbClient(cfg);

    logger.info('Connecting to tenant db');
    await db.connect();

    logger.info('Test tenant DB client created successfully');
    return db;
}

export async function clearTestDb() {
    const db = await getTestDbClient();
    const ctx = createNewContext('setup');

    logger.info(`Deleting all current data in ${ctx.tenantId}`);
    await db.transaction(ctx, async (tx: any) => {
        await tx.resource.deleteMany();
        await tx.system.deleteMany();
        await tx.stage.deleteMany();
        await tx.stagedResource.deleteMany();
    });
}

const once = new Once<DbClient>();

export async function getTestDbClient(): Promise<DbClient> {
    return await once.do(createTestDbClient);
}
