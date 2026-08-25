/*
 * @author Alex
 */

import { IContext } from '../../context';
import { IResource, ISystem, Source } from './artifacts';
import { DbClient, PrismaTx } from './client';
import { Prisma } from '../../../generated/prisma/client';
import { getLogger } from '../../logger';
import { Generate32UUID } from '../../utils/uuid';

const logger = getLogger(__filename);

const errorNotExist = new Error('target not exist');

export interface IResourceToUpdate {
    systemUniqueIdentifier: string;
    resource: IResource;
    source?: Source;
}

export interface IResourceUpdateResult {
    id?: string;
}

export class ResourceDatastore {
    private client: DbClient;

    constructor(client: DbClient) {
        this.client = client;
    }

    async getResource(ctx: IContext, id: string, tx?: PrismaTx): Promise<IResource | null> {
        return await this.client.transaction(
            ctx,
            async (tx: PrismaTx) => {
                const resource = await tx.resource.findFirst({
                    where: {
                        id,
                        tenantId: ctx.tenantId,
                        deletedAt: null,
                    },
                });

                if (!resource) {
                    return null;
                }

                return {
                    nativeUniqueName: resource.nativeUniqueName,
                    version: resource.version,
                    metadata: resource.metadata,
                };
            },
            tx
        );
    }

    async softDelete(ctx: IContext, id: string, tx?: PrismaTx) {
        return await this.client.transaction(
            ctx,
            async (tx: PrismaTx) => {
                try {
                    await tx.resource.update({
                        where: {
                            id,
                            deletedAt: null,
                        },
                        data: { deletedAt: new Date() },
                    });
                } catch (error) {
                    // P2025: Record not found
                    if (
                        error instanceof Prisma.PrismaClientKnownRequestError &&
                        error.code === 'P2025'
                    ) {
                        errorNotExist;
                    }
                    throw error;
                }
            },
            tx
        );
    }

    async createOrUpdateResource(
        ctx: IContext,
        resource: IResourceToUpdate,
        tx?: PrismaTx
    ): Promise<IResourceUpdateResult> {
        logger.debug(ctx, `create or update resource. name=${resource.resource.nativeUniqueName}`);

        return await this.client.transaction(
            ctx,
            async (tx: PrismaTx) => {
                const system = await tx.system.findFirst({
                    where: {
                        tenantId: ctx.tenantId,
                        uniqueIdentifier: resource.systemUniqueIdentifier,
                        deletedAt: null,
                    },
                });

                if (!system) {
                    logger.debug(ctx, `system ${resource.systemUniqueIdentifier} does not exist`);
                    return {};
                }

                const existing = await tx.resource.findFirst({
                    where: {
                        systemId: system.id,
                        nativeUniqueName: resource.resource.nativeUniqueName,
                        deletedAt: null,
                    },
                });

                if (!existing) {
                    logger.debug(ctx, `resource does not exist, creating new...`);
                    const created = await tx.resource.create({
                        data: {
                            id: Generate32UUID(),
                            systemId: system.id,
                            nativeUniqueName: resource.resource.nativeUniqueName,
                            metadata: resource.resource.metadata,
                            version: resource.resource.version,
                            tenantId: ctx.tenantId,
                        },
                    });
                    return { id: created.id };
                }

                logger.debug(ctx, `resource exists, updating current based on version`);

                const incomingVersion = resource.resource.version;
                if (existing.version < incomingVersion) {
                    logger.debug(ctx, `current version outdated, updating new one`);

                    const updated = await tx.resource.update({
                        where: { id: existing.id },
                        data: {
                            metadata: resource.resource.metadata,
                            version: incomingVersion,
                        },
                    });
                    return { id: updated.id };
                }

                logger.debug(ctx, `current version ahead, skip updating`);
                return { id: existing.id };
            },
            tx
        );
    }

    async batchUpsertStage(ctx: IContext, stageIds: string[]) {
        if (stageIds.length === 0) {
            return;
        }

        await this.client.prisma.$executeRaw`
            WITH staged AS (
                SELECT
                    sr."id",
                    sr."tenantId",
                    s."id" AS "systemId",
                    sr."nativeUniqueName",
                    sr."version",
                    sr."metadata",
                    sr."deletedBy"
                FROM "stage"."StageResource" sr
                INNER JOIN "catalog"."System" s
                    ON s."tenantId" = sr."tenantId"
                        AND s."type" = sr."systemType"
                        AND s."uniqueIdentifier" = sr."systemTypeUniqueId"
                        AND s."deletedAt" IS NULL
                LEFT JOIN "catalog"."Resource" r
                    ON r."tenantId" = sr."tenantId"
                        AND r."systemId" = s."id"
                        AND r."nativeUniqueName" = sr."nativeUniqueName"
                        AND r."deletedAt" IS NULL
                WHERE
                    sr."stageId" IN (${Prisma.join(stageIds)})
                    AND (
                            sr."version" > r."version"
                            OR r."version" IS NULL
                        )
            )
            INSERT INTO "catalog"."Resource" (
                "id",
                "tenantId",
                "systemId",
                "nativeUniqueName",
                "version",
                "metadata",
                "deletedBy"
            )
            SELECT * FROM staged
            ON CONFLICT ("tenantId", "systemId", "nativeUniqueName") WHERE "deletedAt" IS NULL
            DO UPDATE SET
                "version"   = EXCLUDED."version",
                "metadata"  = EXCLUDED."metadata",
                "deletedAt" = CASE WHEN EXCLUDED."deletedBy" IS NULL THEN NULL ELSE NOW() END,
                "deletedBy" = EXCLUDED."deletedBy";
        `;
    }
}

export class SystemDatastore {
    private client: DbClient;

    constructor(client: DbClient) {
        this.client = client;
    }

    async create(ctx: IContext, system: ISystem, tx?: PrismaTx): Promise<string> {
        logger.debug(ctx, `create new system, name=${system.uniqueIdentifier}`);

        return await this.client.transaction(
            ctx,
            async (tx: PrismaTx) => {
                const created = await tx.system.create({
                    data: {
                        id: Generate32UUID(),
                        tenantId: ctx.tenantId,
                        uniqueIdentifier: system.uniqueIdentifier,
                        type: system.type,
                    },
                });
                return created.id;
            },
            tx
        );
    }

    async softDelete(ctx: IContext, id: string, tx?: PrismaTx) {
        return await this.client.transaction(
            ctx,
            async (tx: PrismaTx) => {
                try {
                    await tx.system.update({
                        where: {
                            id,
                            deletedAt: null,
                        },
                        data: { deletedAt: new Date() },
                    });
                } catch (error) {
                    // P2025: Record not found
                    if (
                        error instanceof Prisma.PrismaClientKnownRequestError &&
                        error.code === 'P2025'
                    ) {
                        throw errorNotExist;
                    }
                    throw error;
                }
            },
            tx
        );
    }

    async get(ctx: IContext, id: string, tx?: PrismaTx): Promise<ISystem | null> {
        logger.debug(ctx, `get system by id, id=${id}`);

        return await this.client.transaction(
            ctx,
            async (tx: PrismaTx) => {
                const system = await tx.system.findFirst({
                    where: {
                        id,
                        tenantId: ctx.tenantId,
                        deletedAt: null,
                    },
                });

                if (!system) {
                    return null;
                }

                return {
                    uniqueIdentifier: system.uniqueIdentifier,
                    type: system.type,
                };
            },
            tx
        );
    }

    async batchUpsertFromStage(ctx: IContext, stageIds: string[]) {
        await this.client.prisma.$executeRaw`
            INSERT INTO "catalog"."System" (
                "id",
                "createdAt",
                "tenantId",
                "type",
                "uniqueIdentifier"
            )
            SELECT
                ss."stageResourceId",
                NOW() AS "createdAt",
                ss."tenantId",
                ss."type",
                ss."uniqueIdentifier"
            FROM "stage"."StagedSystem" ss
            WHERE ss."stageId" IN (${Prisma.join(stageIds)})
            ON CONFLICT ("tenantId", "uniqueIdentifier") WHERE "deletedAt" IS NULL
            DO NOTHING;
        `;
    }
}

export class StageDatastore {
    private client: DbClient;

    constructor(client: DbClient) {
        this.client = client;
    }

    async stage(
        ctx: IContext,
        resources: Prisma.StageResourceCreateManyInput[],
        relationship: Prisma.StagedRelationshipCreateManyInput[],
        systems: Prisma.StagedSystemCreateManyInput[]
    ) {
        await this.client.transaction(ctx, async tx => {
            await tx.stageResource.createMany({ data: resources });
            await tx.stagedRelationship.createMany({ data: relationship });
            await tx.stagedSystem.createMany({ data: systems });
        });
    }

    async getPendingStages(ctx: IContext, maxStage: number): Promise<string[]> {
        const stageIds = await this.client.prisma.$queryRaw<{ stageId: string }[]>`
            WITH to_lock AS (
                SELECT "stageId", "id"
                FROM "stage"."StageResource"
                WHERE "startIngestAt" IS NULL
                    AND "tenantId" = ${ctx.tenantId}
                FOR UPDATE SKIP LOCKED
            ),
            ranked AS (
                SELECT "stageId", "id",
                       DENSE_RANK() OVER (ORDER BY "stageId") as stage_rank
                FROM to_lock
            ),
            updated AS (
                UPDATE "stage"."StageResource" sr
                SET "startIngestAt" = NOW()
                FROM ranked r
                WHERE sr."stageId" = r."stageId"
                    AND sr."id" = r."id"
                    AND r.stage_rank <= ${maxStage}
                RETURNING sr."stageId"
            )
            SELECT DISTINCT "stageId" FROM updated;
        `;
        return stageIds.map(v => v.stageId);
    }

    async delete(ctx: IContext, stageIds: string[]) {}
}

export class RelationshipDatastore {
    private client: DbClient;

    constructor(client: DbClient) {
        this.client = client;
    }

    async batchUpsertStage(ctx: IContext, stageIds: string[]) {
        if (stageIds.length === 0) {
            return;
        }

        await this.client.prisma.$executeRaw`
            INSERT INTO "catalog"."ResourceRelationship" (
                "sourceId",
                "targetId",
                "type"
            )
            SELECT
                source_sr."id" AS "sourceId",
                target_sr."id" AS "targetId",
                sr."type"
            FROM "stage"."StagedRelationship" sr
            INNER JOIN "stage"."StageResource" source_sr
                ON sr."sourceStageId" = source_sr."id"
                    AND sr."stageId" = source_sr."stageId"
            INNER JOIN "stage"."StageResource" target_sr
                ON sr."targetStageId" = target_sr."id"
                    AND sr."stageId" = target_sr."stageId"
            WHERE sr."stageId" IN (${Prisma.join(stageIds)})
            ON CONFLICT ("sourceId", "targetId")
            DO NOTHING;
        `;
    }
}
