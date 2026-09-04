import { createNewContext } from '../../src/context';
import { RedisClient } from '../../src/infra';
import { AsyncJobService, AsyncTaskUniqueId } from '../../src/service/asyncJob';
import { Generate32UUID } from '../../src/utils/uuid';
import { WaitGroup } from '../../src/utils/waitgroup';
import { getRedisClient } from '../setup';

let redis: RedisClient;

describe('AsyncJobService', () => {
    beforeAll(async () => {
        redis = await getRedisClient();
    });

    it('push job', async () => {
        const ctx = createNewContext('AsyncJobService');
        const taskq = new AsyncJobService(redis, 2, Generate32UUID());
        const taskUniqueId = 'test' as AsyncTaskUniqueId;

        const wg = new WaitGroup();

        const taskHandler = jest.fn().mockImplementation(async () => {
            wg.done();
        });
        taskq.register({
            uniqueId: taskUniqueId,
            handler: taskHandler,
        });

        wg.add(3);
        for (let i = 0; i < 3; i++) {
            await taskq.push(ctx, taskUniqueId, null);
        }

        await wg.wait();
    });
});
