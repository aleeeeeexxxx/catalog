export interface IUrlConfig {
    host: string;
    port: string;
    password: string;
    username: string;
}

export function getUrlFromConfig(protocol: string, cfg: IUrlConfig): string {
    return `${protocol}://${cfg.username}:${cfg.password}@${cfg.host}:${cfg.port}`;
}
