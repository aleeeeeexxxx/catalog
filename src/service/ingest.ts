import Redis from 'ioredis';
import { IContext } from '../context';
import { IStage, ResourceDatastore, StageDatastore } from '../infra/prisma';
import { getLogger } from '../logger';

const logger = getLogger(__filename);

export class Ingest {
    private stageStore: StageDatastore;
    private resource: ResourceDatastore;
    private redis: Redis;

    constructor(resource: ResourceDatastore, stage: StageDatastore, redis: Redis) {
        this.stageStore = stage;
        this.resource = resource;
        this.redis = redis;
    }

    async stage(ctx: IContext, objects: IStage[]) {
        await this.stageStore.stage(ctx, objects);
    }

    async flush(ctx: IContext, stageIds: string[]) {
        await this.resource.batchUpsertStage(ctx, stageIds);
        await this.stageStore.delete(ctx, stageIds);
    }
}
