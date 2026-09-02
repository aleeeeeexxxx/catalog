import { getLogger } from '../src/logger';
import { clearTestDb } from '../test/setup';

const logger = getLogger(__filename);

export default async function () {
    logger.warn('\n===================  GLOBAL SETUP START ===================\n');

    await clearTestDb();

    logger.warn('\n===================  GLOBAL SETUP END   ===================\n');
}
