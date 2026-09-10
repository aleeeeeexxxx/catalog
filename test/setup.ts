import { DbClient } from '../src/dao/prisma/client';
import { getDatabaseUrl, IDbConfig, loadEnvDbConfig } from '../src/dao/prisma/config';
import { getLogger } from '../src/logger';
import { createNewContext } from '../src/context';
import { IRedisConfig, loadEnvRedisConfig, RedisClient } from '../src/dao';
import { Prisma } from '../generated/prisma/client';
import { Once } from '../src/utils/once';
import amqp from 'amqplib';
import { createRabbitMqConnection, IRabbitMqConfig, loadEnvRabbitMqConfig } from '../src/mq';

const logger = getLogger(__filename);

export async function clearDb(db: DbClient) {
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

export const postgres = new Once<DbClient>(async (): Promise<DbClient> => {
    logger.info('Creating test tenant DB client');

    const cfg = loadConfig<IDbConfig>('db', loadEnvDbConfig);
    logger.info(`Loaded DB config: ${getDatabaseUrl(cfg)}`);

    const db = new DbClient(cfg);

    logger.info('Connecting to tenant db');
    await db.connect();

    logger.info('Test tenant DB client created successfully');
    return db;
});

export const redis = new Once<RedisClient>(async (): Promise<RedisClient> => {
    logger.info('Creating test Redis client');

    const cfg = loadConfig<IRedisConfig>('redis', loadEnvRedisConfig);
    logger.info(`Loaded Redis config: ${cfg.host}:${cfg.port}/${cfg.db ?? 0}`);

    const client = RedisClient.New(cfg);

    logger.info('Test Redis client created successfully');
    return client;
});

export const mqConn = new Once<amqp.ChannelModel>(async (): Promise<amqp.ChannelModel> => {
    logger.info('Creating test RabbitMQ channel');

    const cfg = loadConfig<IRabbitMqConfig>('rabbitmq', loadEnvRabbitMqConfig);
    logger.info(`Loaded RabbitMQ config: ${cfg.host}:${cfg.port}`);

    const connection = await createRabbitMqConnection(cfg);

    logger.info('Test RabbitMQ channel created successfully');
    return connection;
});

export function loadDevConfig<T>(component: 'redis' | 'db' | 'rabbitmq'): T {
    const config = require(`../dev/${component}.config.json`);
    return config as T;
}

export function loadConfig<T>(component: 'redis' | 'db' | 'rabbitmq', envLoader: () => T): T {
    if (process.env.LOAD_CONFIG_ENV) {
        return envLoader();
    }
    return loadDevConfig(component);
}
