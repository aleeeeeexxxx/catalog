import { Generate32UUID } from '../../utils/uuid';
import { ISystem } from '../prisma';
import { RedisClient } from './client';

export enum SyncStatus {
    UNKNOWN = 'unknown',
    PENDING = 'pending',
    BROWSING = 'browsing',
    BROWSED = 'browse completed',
    EXTRACTING = 'extracting',
    STAGED = 'staged',
    INGESTING = 'ingesting',
    COMPLETED = 'completed',
}

export interface IWorkflowDescription {
    tenantId: string;
    system: ISystem;
    correlationId: string;
}

export class SyncAllWorkflow {
    private redis: RedisClient;

    static WORKFLOW = 'sync_all_workflow';
    static WORKFLOW_STATUS = 'status';
    static WORKFLOW_SYSTEM = 'system';
    static WORKFLOW_OUTDATED = 'resources';

    static PENDING_OUTDATED_RESOURCE_SCORE = 10;

    constructor(redis: RedisClient) {
        this.redis = redis;
    }

    async createNewWorkflow(
        tenantId: string,
        correlationId: string,
        system: ISystem
    ): Promise<string> {
        const workflowId = Generate32UUID();

        const pipeline = this.redis.pipeline();

        pipeline.set(this.key(SyncAllWorkflow.WORKFLOW_STATUS, workflowId), SyncStatus.PENDING);
        pipeline.set(
            this.key(SyncAllWorkflow.WORKFLOW_SYSTEM, workflowId),
            JSON.stringify({ tenantId, system, correlationId } as IWorkflowDescription)
        );

        await pipeline.exec();

        return workflowId;
    }

    async setWorkflowStatus(workflowId: string, status: SyncStatus) {
        const key = this.key(SyncAllWorkflow.WORKFLOW_STATUS, workflowId);

        if (status === SyncStatus.INGESTING) {
            await this.redis.compareAndSet(key, SyncStatus.EXTRACTING, status);
            return;
        }

        await this.redis.set(key, status);
    }

    async getWorkflowStatus(workflowId: string) {
        return await this.redis.get(this.key(SyncAllWorkflow.WORKFLOW_STATUS, workflowId));
    }

    async cacheOutdated(workflowId: string, outdated: string[]) {
        const param: (number | string)[] = [];
        outdated.forEach(item => {
            param.push(SyncAllWorkflow.PENDING_OUTDATED_RESOURCE_SCORE, item);
        });

        await this.redis.zadd(this.key(SyncAllWorkflow.WORKFLOW_OUTDATED, workflowId), ...param);
    }

    async getOutdatedResources(workflowId: string): Promise<string[]> {
        return await this.redis.zrangebyscore(
            this.key(SyncAllWorkflow.WORKFLOW_OUTDATED, workflowId),
            SyncAllWorkflow.PENDING_OUTDATED_RESOURCE_SCORE - 1,
            SyncAllWorkflow.PENDING_OUTDATED_RESOURCE_SCORE + 1
        );
    }

    async getWorkflowDescription(workflowId: string): Promise<IWorkflowDescription | null> {
        const system = await this.redis.get(this.key(SyncAllWorkflow.WORKFLOW_SYSTEM, workflowId));
        if (!system) {
            return null;
        }

        return JSON.parse(system);
    }

    private key(prefix: string, workflowId: string): string {
        return `workflow/${prefix}-${workflowId}`;
    }
}
