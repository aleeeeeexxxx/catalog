import { RedisClient } from './client';
import { Job, Queue, Worker } from 'bullmq';

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

    constructor(redis: RedisClient, max: number, delay: number, callback: NotifierCallback) {
        this.redis = redis;
        this.max = max;
        this.delay = delay;
        this.callback = callback;
        this.queue = new Queue('ctb_notifier_timer', { connection: this.redis });
        this.worker = new Worker('ctb_notifier_timer', this.handleDelayJob.bind(this), {
            connection: this.redis,
        });
    }

    async close() {
        try {
            await this.queue.close();
            await this.worker.close();
        } catch (err) {
            // todo: log
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
if (kick > 0 and cur > 0) or (kick == 0 and cur == 1) then
    uuid = redis.call('TIME')[1] .. '-' .. math.random(100000, 999999)
    redis.call('SET', wait_key, uuid)
end

return {kick, uuid}
`;
        n = n ?? 1;
        const [kick, uniqueId] = (await this.redis.eval(
            LUA_SCRIPT,
            2,
            this.getCounterKey(key),
            this.getWaiterKey(key),
            n,
            this.max
        )) as [number, string];

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
            await this.queue.add('timeout', counter, { delay });
        } catch (err) {
            // todo: log
        }
    }

    private async handleDelayJob(job: Job) {
        const status = job.data as ICounterStatus;

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
            return;
        }

        void this.runCallback();
    }

    private async runCallback() {
        try {
            await this.callback();
        } catch (err) {
            // todo: log
        }
    }

    private getWaiterKey(key: string): string {
        return `ctb_notifier_waiter@${key}`;
    }

    private getCounterKey(key: string): string {
        return `ctb_notifier_counter@${key}`;
    }
}
