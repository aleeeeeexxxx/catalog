import { createNewContext } from '../../src/context';
import { RabbitMqBroker, RabbitMqDelayBroker } from '../../src/mq/broker';
import { WaitGroup } from '../../src/utils/waitgroup';
import { mqConn } from '../setup';
import { IRabbitMqConfig } from '../../src/mq';

const mockHandler = jest.fn();

describe('RabbitMQ Broker', () => {
    let broker: RabbitMqBroker<string>;

    beforeEach(async () => {
        const conn = await mqConn.get();

        const mockCfg = {
            suffix: `broker_test_${Date.now()}`,
        } as IRabbitMqConfig;
        broker = new RabbitMqBroker(conn, 'test_exchange', 'test_queue', mockCfg);

        mockHandler.mockClear();
    });

    afterEach(async () => {
        await broker?.close();
    });

    it('should register and handle message', async () => {
        const ctx = createNewContext('test-tenant');
        const testTopic = 'test.topic';

        const waiter = new WaitGroup(3000);
        waiter.add();

        mockHandler.mockImplementationOnce(async (ctx, msg) => {
            const content = JSON.parse(msg.content.toString());
            expect(content.message).toBe('hello world');
            waiter.done();
        });

        broker.consume(ctx, testTopic, mockHandler);
        await broker.start(ctx);

        await broker.send(ctx, testTopic, { message: 'hello world' });

        await waiter.wait();
        expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple messages', async () => {
        const ctx = createNewContext('test-tenant');
        const testTopic = 'test.multiple';

        const waiter = new WaitGroup(3000);
        waiter.add(3);

        const messages: string[] = [];

        mockHandler.mockImplementation(async (ctx, msg) => {
            const content = JSON.parse(msg.content.toString());
            messages.push(content.message);
            waiter.done();
        });

        broker.consume(ctx, testTopic, mockHandler);
        await broker.start(ctx);

        await broker.send(ctx, testTopic, { message: 'message1' });
        await broker.send(ctx, testTopic, { message: 'message2' });
        await broker.send(ctx, testTopic, { message: 'message3' });

        await waiter.wait();
        expect(mockHandler).toHaveBeenCalledTimes(3);
        expect(messages).toContain('message1');
        expect(messages).toContain('message2');
        expect(messages).toContain('message3');
    });

    it('should throw error when registering duplicate topic', async () => {
        const ctx = createNewContext('test-tenant');
        const testTopic = 'test.duplicate';

        broker.consume(ctx, testTopic, mockHandler);

        expect(() => {
            broker.consume(ctx, testTopic, mockHandler);
        }).toThrow('Handler already registered for topic: test.duplicate');
    });
});

describe('RabbitMQ Delay Broker', () => {
    let delayBroker: RabbitMqDelayBroker<string>;
    const mockDelayHandler = jest.fn();

    beforeEach(async () => {
        const conn = await mqConn.get();

        const mockCfg = {
            suffix: `delay_broker_test_${Date.now()}`,
        } as IRabbitMqConfig;
        delayBroker = new RabbitMqDelayBroker(
            conn,
            'test_delay_exchange',
            'test_delay_queue',
            mockCfg
        );

        mockDelayHandler.mockClear();
    });

    afterEach(async () => {
        await delayBroker?.close();
    });

    it('should deliver delayed message after delay period', async () => {
        const ctx = createNewContext('test-tenant');
        const testTopic = 'test.delay';
        const delayMs = 500;

        const waiter = new WaitGroup(2000);
        waiter.add();

        const startTime = Date.now();

        mockDelayHandler.mockImplementationOnce(async (ctx, msg) => {
            const content = JSON.parse(msg.content.toString());
            const elapsedTime = Date.now() - startTime;

            expect(content.message).toBe('delayed hello');
            // Should be delayed by at least the specified delay time
            expect(elapsedTime).toBeGreaterThanOrEqual(delayMs);
            waiter.done();
        });

        delayBroker.consumeDelay(ctx, testTopic, mockDelayHandler, delayMs);
        await delayBroker.start(ctx);

        await delayBroker.sendDelayed(ctx, testTopic, { message: 'delayed hello' });

        await waiter.wait();
        expect(mockDelayHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple topics with same delay', async () => {
        const ctx = createNewContext('test-tenant');
        const topic1 = 'test.delay.topic1';
        const topic2 = 'test.delay.topic2';
        const delayMs = 300;

        const waiter = new WaitGroup(2000);
        waiter.add(2);

        const receivedMessages: string[] = [];

        const handler1 = jest.fn(async (ctx, msg) => {
            const content = JSON.parse(msg.content.toString());
            receivedMessages.push(`topic1:${content.message}`);
            waiter.done();
        });

        const handler2 = jest.fn(async (ctx, msg) => {
            const content = JSON.parse(msg.content.toString());
            receivedMessages.push(`topic2:${content.message}`);
            waiter.done();
        });

        delayBroker.consumeDelay(ctx, topic1, handler1, delayMs);
        delayBroker.consumeDelay(ctx, topic2, handler2, delayMs);
        await delayBroker.start(ctx);

        await delayBroker.sendDelayed(ctx, topic1, { message: 'msg1' });
        await delayBroker.sendDelayed(ctx, topic2, { message: 'msg2' });

        await waiter.wait();
        expect(handler1).toHaveBeenCalledTimes(1);
        expect(handler2).toHaveBeenCalledTimes(1);
        expect(receivedMessages).toContain('topic1:msg1');
        expect(receivedMessages).toContain('topic2:msg2');
    });

    it('should handle different delay times for same topic', async () => {
        const ctx = createNewContext('test-tenant');
        const testTopic = 'test.multi.delay';
        const shortDelay = 200;
        const longDelay = 600;

        const waiter = new WaitGroup(2000);
        waiter.add(2);

        const receivedMessages: Array<{ message: string; time: number }> = [];
        const startTime = Date.now();

        mockDelayHandler.mockImplementation(async (ctx, msg) => {
            const content = JSON.parse(msg.content.toString());
            receivedMessages.push({
                message: content.message,
                time: Date.now() - startTime,
            });
            waiter.done();
        });

        delayBroker.consumeDelay(ctx, testTopic, mockDelayHandler, shortDelay);
        delayBroker.consumeDelay(ctx, testTopic, mockDelayHandler, longDelay);
        await delayBroker.start(ctx);

        await delayBroker.sendDelayed(ctx, testTopic, { message: 'short' });
        await delayBroker.sendDelayed(ctx, testTopic, { message: 'long' });

        await waiter.wait();
        expect(mockDelayHandler).toHaveBeenCalledTimes(2);

        // The short delay message should arrive before the long delay message
        const shortMsg = receivedMessages.find(m => m.message === 'short');
        const longMsg = receivedMessages.find(m => m.message === 'long');

        expect(shortMsg).toBeDefined();
        expect(longMsg).toBeDefined();
        expect(shortMsg!.time).toBeLessThan(longMsg!.time);
    });

    it('should handle normal send method inherited from parent', async () => {
        const ctx = createNewContext('test-tenant');
        const testTopic = 'test.normal';

        const waiter = new WaitGroup(2000);
        waiter.add();

        mockDelayHandler.mockImplementationOnce(async (ctx, msg) => {
            const content = JSON.parse(msg.content.toString());
            expect(content.message).toBe('normal message');
            waiter.done();
        });

        delayBroker.consume(ctx, testTopic, mockDelayHandler);
        await delayBroker.start(ctx);

        // Use normal send method (not delayed)
        await delayBroker.send(ctx, testTopic, { message: 'normal message' });

        await waiter.wait();
        expect(mockDelayHandler).toHaveBeenCalledTimes(1);
    });
});
