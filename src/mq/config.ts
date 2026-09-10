import amqp from 'amqplib';
import { getUrlFromConfig, IUrlConfig } from '../utils/url';

export interface IRabbitMqConfig extends IUrlConfig {
    suffix?: string;
}

export async function createRabbitMqConnection(cfg: IRabbitMqConfig): Promise<amqp.ChannelModel> {
    return await amqp.connect(getUrlFromConfig('amqp', cfg));
}

export function loadEnvRabbitMqConfig(): IRabbitMqConfig {
    return {
        host: process.env.RABBITMQ_HOST || 'localhost',
        port: process.env.RABBITMQ_PORT || '5672',
        username: process.env.RABBITMQ_USER || 'catalog',
        password: process.env.RABBITMQ_PASSWORD || 'catalog',
        suffix: process.env.RABBITMQ_SUFFIX || 'default',
    };
}
