/*
 * @author Alex
 */

import { getUrlFromConfig, IUrlConfig } from '../../utils/url';

export interface IDbConfig extends IUrlConfig {
    database?: string;
}

export function getDatabaseUrl(cfg: IDbConfig): string {
    const db = cfg.database ?? 'catalog';
    return `${getUrlFromConfig('postgresql', cfg)}/${db}`;
}

export function loadEnvDbConfig(): IDbConfig {
    return {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: process.env.POSTGRES_PORT || '5432',
        username: process.env.POSTGRES_USER || 'catalog',
        password: process.env.POSTGRES_PASSWORD || 'catalog',
        database: process.env.POSTGRES_DATABASE,
    };
}
