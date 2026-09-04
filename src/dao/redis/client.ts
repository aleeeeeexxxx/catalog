/*
 * @author Alex
 */

import Redis from 'ioredis';
import { getLogger } from '../../logger';

const logger = getLogger(__filename);

export interface IRedisConfig {
    host: string;
    port: number;
    password?: string;
    db?: number;
    keyPrefix?: string;
}

export class RedisClient extends Redis {
    static New(config: IRedisConfig): RedisClient {
        const client = new RedisClient(config);

        client.on('connect', () => {
            logger.info('Redis connected');
        });

        client.on('ready', () => {
            logger.info('Redis ready');
        });

        client.on('error', err => {
            logger.error({ err }, 'Redis error');
        });

        client.on('close', () => {
            logger.warn('Redis connection closed');
        });

        client.on('reconnecting', () => {
            logger.warn('Redis reconnecting...');
        });

        return client;
    }

    private constructor(config: IRedisConfig) {
        super({
            host: config.host,
            port: config.port,
            password: config.password,
            db: config.db ?? 0,
            keyPrefix: config.keyPrefix,
            retryStrategy: (times: number) => {
                const delay = Math.min(times * 50, 2000);
                logger.warn(`Redis connection lost, retrying in ${delay}ms...`);
                return delay;
            },
            maxRetriesPerRequest: null,
        });
    }

    async compareAndSet(
        key: string,
        old: string | number,
        new_: string | number
    ): Promise<boolean> {
        const LUA_CAS = `
local key = KEYS[1]
local expected = ARGV[1]
local newValue = ARGV[2]

local current = redis.call('GET', key)

if current == expected then
    redis.call('SET', key, newValue)
    return 1  -- 成功
else
    return 0  -- 失败
end
`;

        const success = await this.eval(LUA_CAS, 1, key, old, new_);
        return success === 1;
    }
}
