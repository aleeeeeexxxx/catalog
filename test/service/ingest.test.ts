import { createNewContext } from '../../src/context';
import { RedisClient } from '../../src/dao';
import { IRabbitMqConfig } from '../../src/mq';
import { Clock } from '../../src/service/ingest';
import { AsyncTaskService } from '../../src/service/task';
import { Generate32UUID } from '../../src/utils/uuid';
import { WaitGroup } from '../../src/utils/waitgroup';
import { mqConn, redisClient } from '../setup';
import amqp from 'amqplib';

let redis: RedisClient;
let clock: Clock;
let mq: amqp.ChannelModel;
let taskq: AsyncTaskService;

const mockCallback = jest.fn();

describe.skip('clock', () => {
    const ctx = createNewContext('clock-test');

    beforeAll(async () => {
        mq = await mqConn.get();
        redis = await redisClient.get();

        taskq = new AsyncTaskService({ suffix: 'AsyncTaskService' } as IRabbitMqConfig, mq);

        clock = new Clock(redis, 3, 1, mockCallback, taskq, Generate32UUID());

        await taskq.start(ctx);
    });

    afterAll(async () => {
        await taskq.close();
    });

    afterEach(() => {
        mockCallback.mockClear();
    });

    it.only('trigger by add, one by one', async () => {
        const testKey = 'trigger by add, one by one';

        const waiter = new WaitGroup(500);
        waiter.add();

        mockCallback.mockImplementationOnce(async () => {
            waiter.done();
        });

        await clock.add(ctx, testKey, 1);
        await clock.add(ctx, testKey, 1);
        await clock.add(ctx, testKey, 1);

        await waiter.wait();
    });

    it('trigger by add, add once', async () => {
        const testKey = 'trigger by add, add once';

        const waiter = new WaitGroup(500);
        waiter.add();

        mockCallback.mockImplementationOnce(async () => {
            waiter.done();
        });

        await clock.add(ctx, testKey, 3);

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

        await clock.add(ctx, testKey, 2);
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

        await clock.add(ctx, testKey, 4);
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

        await clock.add(ctx, testKey, 2);
        await waiter.wait();

        // new after last hit, should trigger after delay
        const waiter2 = new WaitGroup(1500);
        waiter2.add();

        mockCallback.mockImplementationOnce(async () => {
            waiter2.done();
        });

        await clock.add(ctx, testKey, 1);
        await waiter2.wait();

        // new after last hit, should trigger after delay
        const waiter3 = new WaitGroup(500);
        waiter3.add();

        mockCallback.mockImplementationOnce(async () => {
            waiter3.done();
        });

        await clock.add(ctx, testKey, 3);
        await waiter2.wait();
    });
});
