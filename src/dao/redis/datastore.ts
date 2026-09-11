import { IContext } from '../../context';
import { Generate32UUID } from '../../utils/uuid';
import { ISystem } from '../prisma';
import {
    convertToHashTable,
    convertFromHashTable,
    RedisClient,
    convertToRedisValue,
} from './client';

export enum SyncallStatus {
    PENDING = 'pending',
    BROWSING = 'browsing',
    BROWSED = 'browse completed',
    EXTRACTING = 'extracting',
    INGESTING = 'ingesting',
    COMPLETED = 'completed',
    TIMEOUT = 'timeout',
}

enum SyncallStatusProgress {
    PENDING = 1,
    BROWSING = 2,
    BROWSED = 3,
    EXTRACTING = 4,
    INGESTING = 5,
    TIMEOUT = 8,
    COMPLETED = 10,
}

const SyncallStatusToProgress: Record<SyncallStatus, SyncallStatusProgress> = {
    [SyncallStatus.PENDING]: SyncallStatusProgress.PENDING,
    [SyncallStatus.BROWSING]: SyncallStatusProgress.BROWSING,
    [SyncallStatus.BROWSED]: SyncallStatusProgress.BROWSED,
    [SyncallStatus.EXTRACTING]: SyncallStatusProgress.EXTRACTING,
    [SyncallStatus.INGESTING]: SyncallStatusProgress.INGESTING,
    [SyncallStatus.TIMEOUT]: SyncallStatusProgress.TIMEOUT,
    [SyncallStatus.COMPLETED]: SyncallStatusProgress.COMPLETED,
};

export interface ISyncAllWorkflow {
    // read only
    tenantId: string;
    system: ISystem;
    correlationId: string;
    option: any;

    status: SyncallStatus;
    createdAt: Date;
    endAt?: Date;

    // browse status
    browsed?: number;
    deleted?: number;
    outdated?: number;

    browseStartedAt?: Date;
    browseEndAt?: Date;

    // extract status
    extractStartedAt?: Date;
    extractEndAt?: Date;

    // ingest status
    ingestStartedAt?: Date;
    ingestEndAt?: Date;
    remaining?: number;
}

enum OutdatedResourceScore {
    pending = 10,
    extracting = 20,
    error = 30,
    extracted = 40,
}

export class SyncallWorkflowDatastore {
    private redis: RedisClient;

    constructor(redis: RedisClient) {
        this.redis = redis;
    }

    async createNewWorkflow(ctx: IContext, system: ISystem, option?: any): Promise<string> {
        const workflowId = Generate32UUID();

        const status: ISyncAllWorkflow = {
            tenantId: ctx.tenantId,
            correlationId: ctx.correlationId,
            system: system,
            option: option ?? {},

            status: SyncallStatus.PENDING,
            createdAt: new Date(),
        };

        await this.redis.hset(workflowId, convertToHashTable(status));

        return workflowId;
    }

    async getWorkflow(workflowId: string): Promise<ISyncAllWorkflow> {
        const raw = await this.redis.hgetall(workflowId);
        if (!raw.tenantId) {
            throw new Error(`empty workflow`);
        }

        return convertFromHashTable<ISyncAllWorkflow>(raw);
    }

    async setWorkflowStatus(
        workflowId: string,
        status: SyncallStatus
    ): Promise<{ old: SyncallStatus; set: boolean }> {
        const old = (await this.redis.hget(workflowId, 'status')) as SyncallStatus;
        const ret = { old, set: false };

        if (old === SyncallStatus.TIMEOUT) {
            return ret;
        }

        const old_ = SyncallStatusToProgress[old];
        const cur_ = SyncallStatusToProgress[status];

        if (old_ >= cur_) {
            return ret;
        }

        await this.redis.hset(workflowId, 'status', status);

        ret.set = true;
        return ret;
    }

    async set<
        K extends Exclude<
            keyof ISyncAllWorkflow,
            'tenantId' | 'system' | 'correlationId' | 'option' | 'status' | 'createdAt'
        >,
    >(workflowId: string, key: K, val: ISyncAllWorkflow[K]) {
        const value = convertToRedisValue(val);
        await this.redis.hset(workflowId, key, value);
    }

    async cacheOutdated(workflowId: string, outdated: string[]) {
        const param: (number | string)[] = [];
        outdated.forEach(item => {
            param.push(OutdatedResourceScore.pending, item);
        });

        await this.redis.zadd(this.outdatedResourcesKey(workflowId), ...param);
    }

    async getOutdatedResources(workflowId: string): Promise<string[]> {
        return await this.redis.zrangebyscore(
            this.outdatedResourcesKey(workflowId),
            OutdatedResourceScore.pending - 1,
            OutdatedResourceScore.pending + 1
        );
    }

    private outdatedResourcesKey(workflowId: string): string {
        return `syncall_outdated_${workflowId}`;
    }
}
