/*
 * @author Alex
 */

export interface IDbConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    database?: string;
}

export function getDatabaseUrl(cfg: IDbConfig): string {
    const db = cfg.database ?? 'catalog';

    return `postgresql://${cfg.user}:${cfg.password}@${cfg.host}:${cfg.port}/${db}`;
}
