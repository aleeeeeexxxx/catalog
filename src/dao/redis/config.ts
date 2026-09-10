export interface IRedisConfig {
    host: string;
    port: number;
    password?: string;
    db?: number;
    keyPrefix?: string;
}

export function loadEnvRedisConfig(): IRedisConfig {
    return {
        host: process.env.REDIS_HOST || 'locahost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD,
        db: process.env.REDIS_DB ? parseInt(process.env.REDIS_DB, 10) : undefined,
        keyPrefix: process.env.REDIS_KEY_PREFIX,
    };
}
