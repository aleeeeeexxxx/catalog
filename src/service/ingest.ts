import { createGlobalContext, createNewContext, IContext } from '../context';
import {
    IStageResource,
    Relationship,
    RelationshipDatastore,
    ResourceDatastore,
    StageDatastore,
    SystemDatastore,
} from '../dao/prisma';
import { getLogger } from '../logger';
import { Prisma } from '../../generated/prisma/client';
import { Generate32UUID } from '../utils/uuid';
import { AsyncTaskService, AsyncTaskUniqueId } from './task';
import { RedisClient } from '../dao';

const logger = getLogger(__filename);

const STAGE_NOTIFIER_TOPIC = 'stage_notifier_topic';
const STAGE_NOTIFIER_NAME = 'stage_notifier';
const MAX_WAITING_STAGE = 50;
const DELAY = 60; // 1 min

export type IngestCallback = (ingestedWorkflowIds: string[]) => Promise<void>;

export class IngestService {
    private stageStore: StageDatastore;
    private resourceStore: ResourceDatastore;
    private systemStore: SystemDatastore;
    private relationshipStore: RelationshipDatastore;

    private taskq: AsyncTaskService;

    private ingestCallback: IngestCallback | undefined;

    constructor(
        stageStore: StageDatastore,
        resourceStore: ResourceDatastore,
        systemStore: SystemDatastore,
        relationshipStore: RelationshipDatastore,
        taskq: AsyncTaskService
    ) {
        this.stageStore = stageStore;
        this.resourceStore = resourceStore;
        this.systemStore = systemStore;
        this.relationshipStore = relationshipStore;

        this.taskq = taskq;
        this.taskq.register(createGlobalContext(), {
            uniqueId: AsyncTaskUniqueId.INGEST,
            handler: this.asyncIngestTaskHandler.bind(this),
        });
    }

    setIngestCallback(callback: IngestCallback) {
        if (this.ingestCallback) {
            throw new Error('Ingest callback has already been set');
        }
        this.ingestCallback = callback;
    }

    async stage(ctx: IContext, objects: IStageResource[]): Promise<string[]> {
        logger.info(ctx, `staging resources, length=${objects.length}`);

        const stageIds: string[] = [];

        const resources: Prisma.StageResourceCreateManyInput[] = [];
        const relationship: Prisma.StagedRelationshipCreateManyInput[] = [];

        const systems: Prisma.StagedSystemCreateManyInput[] = [];
        const systemsDedup: Set<string> = new Set();
        const enqueueSystem = (item: Prisma.StagedSystemCreateManyInput) => {
            const key = `${item.tenantId}-${item.type}-${item.uniqueIdentifier}`;
            if (systemsDedup.has(key)) {
                return;
            }

            systemsDedup.add(key);
            systems.push(item);
        };

        objects.forEach(obj => {
            const id = Generate32UUID();
            const stageId = id;
            stageIds.push(stageId);

            resources.push({
                id,
                stageId,
                tenantId: obj.tenantId,
                nativeUniqueName: obj.nativeUniqueName,
                version: obj.version,
                metadata: JSON.stringify(obj.metadata),
                systemType: obj.system.type,
                systemTypeUniqueId: obj.system.uniqueIdentifier,
                deletedAt: obj.deletedAt,
                workflowId: obj.workflowId,
            });

            enqueueSystem({
                stageId,
                stageResourceId: id,
                tenantId: obj.tenantId,
                type: obj.system.type,
                uniqueIdentifier: obj.system.uniqueIdentifier,
            });

            obj.parents?.forEach(parent => {
                const parentId = Generate32UUID();

                resources.push({
                    id: parentId,
                    stageId,
                    tenantId: obj.tenantId,
                    nativeUniqueName: parent.nativeUniqueName,
                    version: parent.version,
                    metadata: JSON.stringify(parent.metadata),
                    systemType: parent.system.type,
                    systemTypeUniqueId: parent.system.uniqueIdentifier,
                    workflowId: obj.workflowId,
                });

                enqueueSystem({
                    stageId,
                    stageResourceId: parentId,
                    tenantId: obj.tenantId,
                    type: parent.system.type,
                    uniqueIdentifier: parent.system.uniqueIdentifier,
                });

                relationship.push({
                    stageId,
                    tenantId: obj.tenantId,
                    sourceStageId: id,
                    targetStageId: parentId,
                    type: Relationship.dependon,
                });
            });

            obj.children?.forEach(child => {
                const childId = Generate32UUID();

                resources.push({
                    id: childId,
                    stageId,
                    tenantId: obj.tenantId,
                    nativeUniqueName: child.nativeUniqueName,
                    version: child.version,
                    metadata: JSON.stringify(child.metadata),
                    systemType: child.system.type,
                    systemTypeUniqueId: child.system.uniqueIdentifier,
                    workflowId: obj.workflowId,
                });

                enqueueSystem({
                    stageId,
                    stageResourceId: childId,
                    tenantId: obj.tenantId,
                    type: child.system.type,
                    uniqueIdentifier: child.system.uniqueIdentifier,
                });

                relationship.push({
                    stageId,
                    tenantId: obj.tenantId,
                    sourceStageId: childId,
                    targetStageId: id,
                    type: Relationship.dependon,
                });
            });
        });

        await this.stageStore.stage(ctx, resources, relationship, systems);
        await this.taskq.push(ctx, AsyncTaskUniqueId.INGEST, null);

        return stageIds;
    }

    async ingest(ctx: IContext, maxStage: number) {
        logger.info(ctx, `Ingesting resources, maxStage=${maxStage}`);
        const stages = await this.stageStore.getPendingStages(ctx, maxStage);

        const stageIds = stages.map(stage => stage.stageId);
        logger.debug(ctx, `Pending stage resources, stagedIds=${JSON.stringify(stageIds)}`);
        if (stageIds.length === 0) {
            logger.info(ctx, `No staged resources got, skip ingesting`);
            return [];
        }

        logger.info(
            ctx,
            `Staged resources to ingest, length=${stageIds.length}, stagedIds=${JSON.stringify(stageIds)}`
        );

        await this.systemStore.batchUpsertFromStage(ctx, stageIds);
        await this.resourceStore.batchUpsertStage(ctx, stageIds);
        await this.relationshipStore.batchUpsertStage(ctx, stageIds);

        await this.stageStore.delete(ctx, stageIds);

        if (this.ingestCallback) {
            const workflowIds = new Set<string>();
            stages.forEach(stage => {
                if (stage.workflowId) {
                    workflowIds.add(stage.workflowId);
                }
            });

            void this.ingestCallback(Array.from(workflowIds));
        }
    }

    async countUningested(ctx: IContext, workflowId: string): Promise<number> {
        return this.stageStore.countStagesByWorkflowId(ctx, workflowId);
    }

    private async asyncIngestTaskHandler(_param: any) {
        const ctx = createGlobalContext();
        const maxStage = MAX_WAITING_STAGE + 10;

        await this.ingest(ctx, maxStage);
    }
}

export type NotifierCallback = () => Promise<void>;

interface ICounterStatus {
    key: string;
    uniqueId: string;
}

export class Clock {
    private redis: RedisClient;
    private max: number;
    private delay: number; // second
    private callback: NotifierCallback;
    private taskq: AsyncTaskService;
    private topic: string;

    constructor(
        redis: RedisClient,
        max: number,
        delay: number,
        callback: NotifierCallback,
        taskq: AsyncTaskService,
        topic: string
    ) {
        this.redis = redis;
        this.max = max;
        this.delay = delay;
        this.callback = callback;
        this.topic = topic;

        this.taskq = taskq;
        this.taskq.register(createGlobalContext(), {
            uniqueId: AsyncTaskUniqueId.COUNTER_CLOCK,
            handler: this.handleDelayJob.bind(this),
            delay: this.delay,
        });
    }

    async add(ctx: IContext, key: string, n?: number) {
        const LUA_SCRIPT = `
local key = KEYS[1]
local wait_key = KEYS[2]
local n = tonumber(ARGV[1])

local cnt_str = redis.call('GET', key)
local cnt = tonumber(cnt_str) or 0

local cur = cnt + n

local kick = 0

while cur >= ${this.max} do
    cur = cur - ${this.max}
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
        logger.info(`Adding to counter, key=${key}, n=${n}, max=${this.max}`);

        const [kick, uniqueId] = (await this.redis.eval(
            LUA_SCRIPT,
            2,
            this.getCounterKey(key),
            this.getWaiterKey(key),
            n
        )) as [number, string];

        logger.debug(`Get count result, key=${key}, kick=${kick}, uuid=${uniqueId}`);

        for (let i = 0; i < kick; i++) {
            void this.runCallback();
        }

        if (uniqueId.length > 0) {
            void this.createDelayJob(ctx, { key, uniqueId });
        }
    }

    private async createDelayJob(ctx: IContext, status: ICounterStatus) {
        logger.debug(`creating delay job, status=${JSON.stringify(status)}`);

        try {
            await this.taskq.push(ctx, AsyncTaskUniqueId.COUNTER_CLOCK, status);
        } catch (err) {
            // log
        }
    }

    private async handleDelayJob(status: ICounterStatus) {
        logger.debug(`Handling delay job, status=${JSON.stringify(status)}`);

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
        await this.runCallback();
    }

    private async runCallback() {
        logger.debug('Running clock callback');

        try {
            await this.callback();
        } catch (err) {
            logger.error({ err }, 'Notifier callback failed');
        }
    }

    private getWaiterKey(key: string): string {
        return `clock_${this.topic}@${key}`;
    }

    private getCounterKey(key: string): string {
        return `clock_${this.topic}@${key}`;
    }
}
