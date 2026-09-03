import { DbClient } from '../src/infra/prisma/client';
import { IDbConfig } from '../src/infra/prisma/config';
import { IRedisConfig } from '../src/infra/redis/client';
import { Once } from '../src/utils/once';
import { getLogger } from '../src/logger';
import { createNewContext } from '../src/context';
import { RedisClient } from '../src/infra';
import { Prisma } from '../generated/prisma/client';

const logger = getLogger(__filename);

function loadDevDbConfig(): IDbConfig {
    // Priority: environment variables > dev config file
    if (process.env.DATABASE_URL) {
        // Parse DATABASE_URL (e.g., postgresql://user:password@host:port/database)
        const url = new URL(process.env.DATABASE_URL);
        return {
            host: url.hostname,
            port: parseInt(url.port || '5432', 10),
            user: url.username,
            password: url.password,
            database: url.pathname.slice(1), // Remove leading '/'
        };
    }

    // Fallback to dev config file for local development
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
    await db.transaction(ctx, async (tx: Prisma.TransactionClient) => {
        await tx.resource.deleteMany();
        await tx.system.deleteMany();
        await tx.resourceRelationship.deleteMany();

        await tx.stageResource.deleteMany();
        await tx.stagedSystem.deleteMany();
        await tx.stagedRelationship.deleteMany();
    });
}

const dbClient = new Once<DbClient>();

export async function getTestDbClient(): Promise<DbClient> {
    return await dbClient.do(createTestDbClient);
}

function loadDevRedisConfig(): IRedisConfig {
    // Priority: environment variables > dev config file
    if (process.env.REDIS_HOST) {
        return {
            host: process.env.REDIS_HOST,
            port: parseInt(process.env.REDIS_PORT || '6379', 10),
            password: process.env.REDIS_PASSWORD,
            db: process.env.REDIS_DB ? parseInt(process.env.REDIS_DB, 10) : undefined,
            keyPrefix: process.env.REDIS_KEY_PREFIX,
        };
    }

    // Fallback to dev config file for local development
    const config = require('../dev/redis.config.json');
    return {
        host: config.host,
        port: parseInt(config.port, 10),
        password: config.password,
        db: config.db,
        keyPrefix: config.keyPrefix,
    };
}

async function createTestRedisClient(): Promise<RedisClient> {
    logger.info('Creating test Redis client');

    const cfg = loadDevRedisConfig();
    logger.info(`Loaded Redis config: ${cfg.host}:${cfg.port}/${cfg.db ?? 0}`);

    const client = RedisClient.New(cfg);

    logger.info('Test Redis client created successfully');
    return client;
}

const redis = new Once<RedisClient>();

export async function getRedisClient(): Promise<RedisClient> {
    return await redis.do(createTestRedisClient);
}
