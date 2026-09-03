import { getLogger } from '../src/logger';
import { getTestDbClient, getRedisClient } from '../test/setup';

const logger = getLogger(__filename);

export default async function () {
    logger.warn('\n===================  GLOBAL TEARDOWN START ===================\n');

    try {
        // Close Redis connection first (to stop any background jobs)
        const redis = await getRedisClient();
        await redis.quit(); // Use quit() instead of disconnect() to wait for pending commands
        logger.info('Redis connection closed');
    } catch (error) {
        logger.error({ error }, 'Error closing Redis connection');
    }

    try {
        // Close DB connection
        const db = await getTestDbClient();
        await db.disconnect();
        logger.info('DB connection closed');
    } catch (error) {
        logger.error({ error }, 'Error closing DB connection');
    }

    // Give a small delay to allow any remaining async operations to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    logger.warn('\n===================  GLOBAL TEARDOWN END   ===================\n');
}
