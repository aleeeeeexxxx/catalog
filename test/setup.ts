import { TenantDbClient } from '../src/dao/client';
import { IDbConfig } from '../src/dao/config';
import { Once } from '../src/utils/once';
import { getLogger } from '../src/logger';
import { IContext } from '../src/context';
import { v4 as uuidv4 } from 'uuid';

const logger = getLogger(__filename);

export function getSharedTestContext(): IContext {
    return {
        tenantId: process.env.TEST_TENANT || 'catalog_test',
        correlationId: uuidv4(),
    };
}

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

async function createTestTenantDbClient(): Promise<TenantDbClient> {
    logger.info('Creating test tenant DB client');

    const cfg = loadDevDbConfig();
    logger.info(`Loaded DB config: ${cfg.host}:${cfg.port}/${cfg.database || 'catalog'}`);

    const db = new TenantDbClient(cfg);

    logger.info('Connecting to tenant db');
    await db.connect();

    logger.info('Test tenant DB client created successfully');
    return db;
}

const once = new Once<TenantDbClient>();

export async function getTestTenantDbClient(): Promise<TenantDbClient> {
    return await once.do(createTestTenantDbClient);
}
