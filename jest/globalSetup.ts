import { getLogger } from '../src/logger';
import { clearDb, postgres } from '../test/setup';

const logger = getLogger(__filename);

export default async function () {
    logger.warn('\n===================  GLOBAL SETUP START ===================\n');

    const dbClient = await postgres.get();
    await clearDb(dbClient);

    logger.warn('\n===================  GLOBAL SETUP END   ===================\n');
}
