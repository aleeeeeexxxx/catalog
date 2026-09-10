export enum RoutingKey {
    BROWSE = 'browse',
    EXTRACT = 'extract',
    INGEST = 'ingest',
    MONITOR_INGEST = 'monitorIngest',
}

const EXCHANGE = 'catalog_task_exchange';
const QUEUE = 'catalog_task_queue';
