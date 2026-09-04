import { CountAndTimerBasedNotifier, RedisClient } from '../../src/infra';
import { Generate32UUID } from '../../src/utils/uuid';
import { WaitGroup } from '../../src/utils/waitgroup';
import { getRedisClient } from '../setup';

let redis: RedisClient;
let notifier: CountAndTimerBasedNotifier;
const mockCallback = jest.fn();

describe('notifier', () => {
    beforeAll(async () => {
        redis = await getRedisClient();
        notifier = new CountAndTimerBasedNotifier(redis, 3, 1, mockCallback, Generate32UUID());
    });

    afterEach(() => {
        mockCallback.mockClear();
    });

    it('trigger by add, one by one', async () => {
        const testKey = 'trigger by add, one by one';

        const waiter = new WaitGroup(500);
        waiter.add();

        mockCallback.mockImplementationOnce(async () => {
            waiter.done();
        });

        await notifier.add(testKey, 1);
        await notifier.add(testKey, 1);
        await notifier.add(testKey, 1);

        await waiter.wait();
    });

    it('trigger by add, add once', async () => {
        const testKey = 'trigger by add, add once';

        const waiter = new WaitGroup(500);
        waiter.add();

        mockCallback.mockImplementationOnce(async () => {
            waiter.done();
        });

        await notifier.add(testKey, 3);

        await waiter.wait();
    });

    it('trigger by delay', async () => {
        const testKey = 'trigger by delay';

        const waiter = new WaitGroup(2000);
        waiter.add();

        const start = Date.now();
        let end: number | undefined;

        mockCallback.mockImplementationOnce(async () => {
            waiter.done();
            end = Date.now();
        });

        await notifier.add(testKey, 2);
        await waiter.wait();

        expect(end).toBeDefined();
        expect(end! - start).toBeGreaterThanOrEqual(1000);
    });

    it('trigger twice', async () => {
        const testKey = 'trigger twice';

        const waiter = new WaitGroup(1500);
        waiter.add(2);

        const start = Date.now();
        let end: number | undefined;

        mockCallback.mockImplementation(async () => {
            waiter.done();
            end = Date.now();
        });

        await notifier.add(testKey, 4);
        await waiter.wait();

        expect(end).toBeDefined();
        expect(end! - start).toBeGreaterThanOrEqual(1000);
    });

    it('seq trigger, delay and trigger immediately', async () => {
        const testKey = 'trigger by delay';

        const waiter = new WaitGroup(1500);
        waiter.add();

        mockCallback.mockImplementationOnce(async () => {
            waiter.done();
        });

        await notifier.add(testKey, 2);
        await waiter.wait();

        // new after last hit, should trigger after delay
        const waiter2 = new WaitGroup(1500);
        waiter2.add();

        mockCallback.mockImplementationOnce(async () => {
            waiter2.done();
        });

        await notifier.add(testKey, 1);
        await waiter2.wait();

        // new after last hit, should trigger after delay
        const waiter3 = new WaitGroup(500);
        waiter3.add();

        mockCallback.mockImplementationOnce(async () => {
            waiter3.done();
        });

        await notifier.add(testKey, 3);
        await waiter2.wait();
    });
});
