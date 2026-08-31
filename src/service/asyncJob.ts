import { Queue, Worker, Job } from 'bullmq';
import { RedisClient } from '../infra/redis/client';
import { IContext } from '../context';
import { getLogger } from '../logger';

const logger = getLogger(__filename);
const CATALOG_TASK_QUEUE = 'catalog_task_queue';

export enum AsyncTaskUniqueId {
    INGEST = 'ingest',
}

interface IBulkTask {
    id: AsyncTaskUniqueId;
    param: any;
}

export interface IAsyncTaskDescription {
    uniqueId: AsyncTaskUniqueId;
    handler: (param: any) => Promise<void>;
}

export class AsyncJobService {
    private queue: Queue;
    private worker: Worker;

    private jobs: Map<AsyncTaskUniqueId, IAsyncTaskDescription>;

    constructor(redis: RedisClient) {
        this.queue = new Queue(CATALOG_TASK_QUEUE, { connection: redis });
        this.worker = new Worker(CATALOG_TASK_QUEUE, this.handleJob.bind(this), {
            connection: redis,
            concurrency: 10,
        });

        this.jobs = new Map();
    }

    register(job: IAsyncTaskDescription) {
        this.jobs.set(job.uniqueId, job);
    }

    async push(ctx: IContext, id: AsyncTaskUniqueId, jobId: string, param: any) {
        logger.info(ctx, `enqueue task, task unique id=${id}, jobId=${jobId}`);

        const job = {
            id,
            param,
        } as IBulkTask;
        await this.queue.add(CATALOG_TASK_QUEUE, job, { jobId });
    }

    private async handleJob(job: Job) {
        const { data } = job;
        const task = data as IBulkTask;

        const taskDesc = this.jobs.get(task.id);
        if (!taskDesc) {
            return;
        }

        try {
            await taskDesc.handler(task.param);
        } catch (err) {
            logger.error('failed to run job');
        }
    }
}
