import { RedisClient } from './client';
import { Job, Queue, Worker } from 'bullmq';
import { getLogger } from '../../logger';

const logger = getLogger(__filename);

export type NotifierCallback = () => Promise<void>;

interface ICounterStatus {
    key: string;
    uniqueId: string;
}

export class CountAndTimerBasedNotifier {
    private redis: RedisClient;
    private max: number;
    private delay: number; // second
    private callback: NotifierCallback;
    private queue: Queue;
    private worker: Worker;
    private topic: string;

    constructor(
        redis: RedisClient,
        max: number,
        delay: number,
        callback: NotifierCallback,
        topic: string
    ) {
        this.redis = redis;
        this.max = max;
        this.delay = delay;
        this.callback = callback;
        this.queue = new Queue(topic, { connection: redis });
        this.worker = new Worker(topic, this.handleDelayJob.bind(this), {
            connection: redis,
        });
        this.topic = topic;
    }

    async close() {
        try {
            logger.info('Closing CountAndTimerBasedNotifier');
            await this.queue.close();
            await this.worker.close();
            logger.info('CountAndTimerBasedNotifier closed successfully');
        } catch (err) {
            logger.error({ err }, 'Failed to close CountAndTimerBasedNotifier');
        }
    }

    async add(key: string, n?: number) {
        const LUA_SCRIPT = `
local key = KEYS[1]
local wait_key = KEYS[2]
local n = tonumber(ARGV[1])
local max = tonumber(ARGV[2])

local cnt = tonumber(redis.call('GET', key) or 0)
local cur = cnt + n

local kick = 0

while cur >= max do
    cur = cur - max
    kick = kick + 1
end

redis.call('SET', key, cur)

local uuid = ''
if (kick > 0 and cur > 0) or (kick == 0 and cur - n == 0) then
    uuid = redis.call('TIME')[1] .. '-' .. math.random(100000, 999999)
    redis.call('SET', wait_key, uuid)
end

return {kick, uuid}
`;
        n = n ?? 1;
        logger.debug({ key, n, max: this.max }, 'Adding to counter');

        const [kick, uniqueId] = (await this.redis.eval(
            LUA_SCRIPT,
            2,
            this.getCounterKey(key),
            this.getWaiterKey(key),
            n,
            this.max
        )) as [number, string];

        logger.debug(
            { key, kick, uniqueId },
            `Get count result, key=${key}, kick=${kick}, uuid=${uniqueId}`
        );

        for (let i = 0; i < kick; i++) {
            void this.runCallback();
        }

        if (uniqueId.length > 0) {
            void this.createDelayJob({ key, uniqueId });
        }
    }

    private async createDelayJob(counter: ICounterStatus) {
        try {
            const delay = this.delay * 1000;
            logger.debug({ counter, delay }, `Creating delay job, delay=${this.delay}s`);
            await this.queue.add('timeout', counter, { delay });
        } catch (err) {
            logger.error({ err, counter }, 'Failed to create delay job');
        }
    }

    private async handleDelayJob(job: Job) {
        const status = job.data as ICounterStatus;
        logger.debug({ status }, 'Handling delay job');

        const LUA_SCRIPT = `
local cnt_key = KEYS[1]
local wait_key = KEYS[2]
local wait_id = ARGV[1]

local cur = redis.call('GET', wait_key)
if cur ~= wait_id then
    return 1
else
    redis.call('SET', wait_key, '')
    redis.call('SET', cnt_key, 0)
    return 0
end
        `;

        const outdated = await this.redis.eval(
            LUA_SCRIPT,
            2,
            this.getCounterKey(status.key),
            this.getWaiterKey(status.key),
            status.uniqueId
        );

        if (outdated) {
            logger.debug({ status }, 'Delay job is outdated, skipping');
            return;
        }

        logger.debug({ status }, 'Delay job triggered, running callback');
        void this.runCallback();
    }

    private async runCallback() {
        try {
            logger.debug('Running notifier callback');
            await this.callback();
            logger.debug('Notifier callback completed');
        } catch (err) {
            logger.error({ err }, 'Notifier callback failed');
        }
    }

    private getWaiterKey(key: string): string {
        return `ctr_${this.topic}@${key}`;
    }

    private getCounterKey(key: string): string {
        return `ctr_${this.topic}@${key}`;
    }
}
