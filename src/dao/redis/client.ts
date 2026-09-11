/*
 * @author Alex
 */

import Redis from 'ioredis';
import { getLogger } from '../../logger';
import { IRedisConfig } from './config';

const logger = getLogger(__filename);

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

export function convertToHashTable(obj: Object): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(obj)) {
        if (value === null || value === undefined) {
            continue;
        }

        result[key] = convertToRedisValue(value);
    }

    return result;
}

export function convertToRedisValue(value: any): string {
    if (value instanceof Date) {
        return value.toISOString();
    } else if (typeof value === 'object') {
        return JSON.stringify(value);
    } else {
        return String(value);
    }
}

export function convertFromHashTable<T>(raw: Record<string, string>): T {
    const result: any = {};

    for (const [key, value] of Object.entries(raw)) {
        // 尝试 JSON 解析（处理对象和数组）
        if (value.startsWith('{') || value.startsWith('[')) {
            try {
                result[key] = JSON.parse(value);
                continue;
            } catch {
                // 解析失败，按字符串处理
            }
        }

        // 尝试 Date 解析（ISO 8601 格式）
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(value)) {
            result[key] = new Date(value);
            continue;
        }

        // 尝试数字解析
        if (/^-?\d+(\.\d+)?$/.test(value)) {
            result[key] = Number(value);
            continue;
        }

        // 布尔值
        if (value === 'true' || value === 'false') {
            result[key] = value === 'true';
            continue;
        }

        // 默认保持字符串
        result[key] = value;
    }

    return result as T;
}
