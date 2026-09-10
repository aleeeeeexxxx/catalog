import { getLogger } from '../src/logger';
import { postgres, redisClient, mqConn } from '../test/setup';

const logger = getLogger(__filename);

export default async function () {
    logger.warn('\n===================  GLOBAL TEARDOWN START ===================\n');

    // Close connections in reverse order of initialization
    const closePromises: Promise<void>[] = [];

    closePromises.push(
        mqConn
            .get()
            .then(async connection => {
                await connection.close();
                logger.info('RabbitMQ connection closed');
            })
            .catch(error => {
                logger.error({ error }, 'Error closing RabbitMQ connection');
            })
    );

    closePromises.push(
        redisClient
            .get()
            .then(async client => {
                await client.quit();
                logger.info('Redis connection closed');
            })
            .catch(error => {
                logger.error({ error }, 'Error closing Redis connection');
            })
    );

    // Close DB connection
    closePromises.push(
        postgres
            .get()
            .then(async dbClient => {
                await dbClient.disconnect();
                logger.info('DB connection closed');
            })
            .catch(error => {
                logger.error({ error }, 'Error closing DB connection');
            })
    );

    // Wait for all connections to close
    await Promise.all(closePromises);

    logger.warn('\n===================  GLOBAL TEARDOWN END   ===================\n');
}
