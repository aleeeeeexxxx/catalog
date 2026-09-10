import { createNewContext, IContext } from '../context';
import { getLogger } from '../logger';
import amqp from 'amqplib';
import { IRabbitMqConfig } from './config';

const logger = getLogger(__filename);

export type MessageHandler = (ctx: IContext, msg: amqp.ConsumeMessage) => Promise<void>;

const ROUTING_KEY_PREFIX = 'catalog.message';

export class RabbitMqBroker<T extends string> {
    private connection: amqp.ChannelModel;
    protected handler: Map<T, MessageHandler>;

    protected exchange: string;
    protected queue: string;

    protected channel?: amqp.Channel;

    protected getRoutingKey(topic: T): string {
        return `${ROUTING_KEY_PREFIX}.${topic}`;
    }

    protected publishMessage(
        ctx: IContext,
        exchange: string,
        routingKey: T,
        msgBody: any
    ): boolean | undefined {
        const santizedRoutingKey = this.getRoutingKey(routingKey);

        return this.channel?.publish(
            exchange,
            santizedRoutingKey,
            Buffer.from(JSON.stringify(msgBody)),
            {
                persistent: true,
                contentType: 'application/json',
                headers: {
                    'x-correlation-id': ctx.correlationId,
                    'x-tenant-id': ctx.tenantId,
                    'x-catalog-topic': routingKey,
                },
            }
        );
    }

    constructor(
        connection: amqp.ChannelModel,
        exchange: string,
        queue: string,
        cfg: IRabbitMqConfig
    ) {
        this.connection = connection;
        this.handler = new Map();
        this.exchange = `${exchange}_${cfg.suffix}`;
        this.queue = `${queue}_${cfg.suffix}`;
    }

    consume(ctx: IContext, topic: T, handler: MessageHandler) {
        if (this.handler.has(topic)) {
            throw new Error(`Handler already registered for topic: ${topic}`);
        }

        logger.debug(ctx, `Registering consumer for topic: ${topic}`);
        this.handler.set(topic, handler);
    }

    async start(ctx: IContext) {
        logger.info(
            ctx,
            `Starting RabbitMQ broker - exchange: ${this.exchange}, queue: ${this.queue}`
        );

        this.channel = await this.connection.createChannel();

        // Add error handler to prevent unhandled channel errors
        this.channel.on('error', err => {
            logger.error(ctx, `Channel error: ${err.message}`);
        });

        await this.channel.assertExchange(this.exchange, 'topic', { durable: true });

        await this.channel.assertQueue(this.queue, { durable: true });
        await this.channel.bindQueue(this.queue, this.exchange, `${ROUTING_KEY_PREFIX}.#`);

        this.channel.prefetch(10);

        await this.channel.consume(this.queue, this.handleMessage.bind(this));
        logger.info(ctx, `RabbitMQ broker started successfully`);
    }

    async send(ctx: IContext, routingKey: T, msgBody: any) {
        const santizedRoutingKey = this.getRoutingKey(routingKey);

        logger.debug(
            ctx,
            `Sending message to exchange: ${this.exchange}, routingKey: ${santizedRoutingKey}`
        );

        const send = this.publishMessage(ctx, this.exchange, routingKey, msgBody);

        logger.debug(ctx, `Message sent successfully, publish result: ${send}`);
    }

    async handleMessage(msg: amqp.ConsumeMessage | null) {
        if (!msg) {
            return;
        }

        const ctx = createNewContext('');

        const topic = msg.properties.headers?.['x-catalog-topic'];
        if (!topic) {
            logger.warn(ctx, `Received message without topic header, rejecting`);
            return;
        }

        logger.debug(ctx, `Received message for topic: ${topic}`);

        const handler = this.handler.get(topic);
        if (!handler) {
            logger.warn(ctx, `No handler registered for topic: ${topic}, rejecting`);
            return;
        }

        try {
            await handler(ctx, msg);
            logger.debug(ctx, `Message processed successfully for topic: ${topic}`);
        } catch (err) {
            logger.error(ctx, `Error processing message for topic ${topic}: ${err}`);
        } finally {
            this.channel?.ack(msg);
        }
    }

    async close() {
        const channel = this.channel;
        if (channel) {
            this.channel = undefined;
            await channel.close();
        }
    }
}

export class RabbitMqDelayBroker<T extends string> extends RabbitMqBroker<T> {
    private delayExchange: string;
    private delayTimes: Set<number>;

    constructor(
        connection: amqp.ChannelModel,
        exchange: string,
        queue: string,
        cfg: IRabbitMqConfig
    ) {
        super(connection, exchange, queue, cfg);
        this.delayExchange = `${this.exchange}_delay`;
        this.delayTimes = new Set();
    }

    consumeDelay(ctx: IContext, topic: T, handler: MessageHandler, delay: number) {
        logger.debug(ctx, `Registering delay consumer for topic: ${topic}, delay: ${delay}ms`);
        this.delayTimes.add(delay);

        // Also register the handler in parent class for normal consumption
        if (!this.handler.has(topic)) {
            super.consume(ctx, topic, handler);
        }
    }

    async start(ctx: IContext) {
        await super.start(ctx);

        // Create delay exchange (for routing delayed messages to TTL queues)
        await this.channel!.assertExchange(this.delayExchange, 'topic', { durable: true });

        // Create delay queues for all registered delay times
        for (const delay of this.delayTimes) {
            const delayQueueName = `${this.queue}_delay_${delay}`;

            logger.debug(ctx, `Creating delay queue: ${delayQueueName} with delay: ${delay}ms`);

            // Assert delay queue with TTL and DLX settings
            await this.channel!.assertQueue(delayQueueName, {
                durable: true,
                arguments: {
                    'x-message-ttl': delay,
                    'x-dead-letter-exchange': this.exchange,
                },
            });

            // Bind delay queue to delay exchange
            await this.channel!.bindQueue(
                delayQueueName,
                this.delayExchange,
                `${ROUTING_KEY_PREFIX}.#`
            );
        }

        logger.info(ctx, `RabbitMQ delay broker started with ${this.delayTimes.size} delay queues`);
    }

    async sendDelayed(ctx: IContext, routingKey: T, msgBody: any, delayMs: number) {
        const santizedRoutingKey = this.getRoutingKey(routingKey);

        logger.debug(
            ctx,
            `Sending delayed message (${delayMs}ms) via routing key: ${santizedRoutingKey}`
        );

        // Publish to delay exchange with topic routing key
        const send = this.publishMessage(ctx, this.delayExchange, routingKey, msgBody);

        logger.debug(
            ctx,
            `Delayed message sent successfully, publish result: ${send}, delay: ${delayMs}ms`
        );
    }
}
