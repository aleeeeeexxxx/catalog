import { IContext } from '../context';
import { IRabbitMqConfig, MessageHandler, RabbitMqDelayBroker } from '../mq';
import amqp from 'amqplib';
import { SECOND } from '../utils/time';

export enum RoutingKey {
    BROWSE = 'browse',
    EXTRACT = 'extract',
    INGEST = 'ingest',
    MONITOR_INGEST = 'monitorIngest',
}

const EXCHANGE = 'catalog_task_exchange';
const QUEUE = 'catalog_task_queue';

export enum AsyncTaskUniqueId {
    INGEST = 'ingest',
    BROWSE = 'browse',
    SNAPSHOT = 'snapshot',
    EXTRACT = 'extract',
    MONITOR_INGEST = 'monitoring',

    COUNTER_CLOCK = 'cc',
}

export type TaskHandler<T> = (param: T) => Promise<void>;

export interface IAsyncTaskDescription<T> {
    uniqueId: AsyncTaskUniqueId;
    delay?: number;
    handler: TaskHandler<T>;
}

export class AsyncTaskService {
    private broker: RabbitMqDelayBroker<AsyncTaskUniqueId>;
    private delayTaskId: Set<AsyncTaskUniqueId>;

    constructor(cfg: IRabbitMqConfig, conn: amqp.ChannelModel) {
        this.broker = new RabbitMqDelayBroker(conn, EXCHANGE, QUEUE, cfg);
        this.delayTaskId = new Set();
    }

    async start(ctx: IContext) {
        await this.broker.start(ctx);
    }

    async close() {
        await this.broker.close();
    }

    register<T>(task: IAsyncTaskDescription<T>) {
        if (task.delay) {
            this.broker.consumeDelay(
                task.uniqueId,
                this.wrapHandler(task.handler),
                task.delay * SECOND
            );

            this.delayTaskId.add(task.uniqueId);

            return;
        }

        this.broker.consume(task.uniqueId, this.wrapHandler(task.handler));
    }

    async push<T>(ctx: IContext, taskId: AsyncTaskUniqueId, param: T) {
        if (this.delayTaskId.has(taskId)) {
            this.broker.sendDelayed(ctx, taskId, param);
            return;
        }

        await this.broker.send(ctx, taskId, param);
    }

    private wrapHandler<T>(handler: TaskHandler<T>): MessageHandler {
        return async (ctx: IContext, msg: amqp.ConsumeMessage) => {
            const raw = msg.content.toString();
            const param = JSON.parse(raw) as T;

            try {
                await handler(param);
            } catch (err) {}
        };
    }
}
