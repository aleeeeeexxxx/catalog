import { createNewContext } from '../../src/context';
import { IRabbitMqConfig } from '../../src/mq';
import { AsyncTaskService, AsyncTaskUniqueId } from '../../src/service/task';
import { WaitGroup } from '../../src/utils/waitgroup';
import { mqConn } from '../setup';
import amqp from 'amqplib';

let mq: amqp.ChannelModel;

describe('AsyncTaskService', () => {
    beforeAll(async () => {
        mq = await mqConn.get();
    });

    it('push job', async () => {
        const ctx = createNewContext('AsyncJobService');
        const taskq = new AsyncTaskService({ suffix: 'AsyncTaskService' } as IRabbitMqConfig, mq);

        const wg = new WaitGroup();
        const taskHandler = jest.fn().mockImplementation(async () => {
            wg.done();
        });

        const taskUniqueId = 'test' as AsyncTaskUniqueId;
        taskq.register(ctx, {
            uniqueId: taskUniqueId,
            handler: taskHandler,
        });

        await taskq.start(ctx);

        wg.add(3);
        for (let i = 0; i < 3; i++) {
            await taskq.push(ctx, taskUniqueId, null);
        }

        await wg.wait();
    });
});
