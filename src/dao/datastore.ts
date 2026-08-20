/*
 * @author Alex
 */

import { IContext } from '../context';
import { IResource, IStage, ISystem, Source } from './artifacts';
import { DbClient, PrismaTx } from './client';
import { Prisma } from '../../generated/prisma/client';
import { getLogger } from '../logger';
import { Generate32UUID } from '../utils/uuid';

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
                    name: resource.name,
                    description: resource.desc,
                    version: resource.version,
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
                            name: resource.resource.name,
                            desc: resource.resource.description,
                            version: resource.resource.version,
                            tenantId: ctx.tenantId,
                        },
                    });
                    return { id: created.id };
                }

                logger.debug(ctx, `resource exists, updating current based on version`);

                if (existing.version < resource.resource.version) {
                    logger.debug(ctx, `current version outdated, updating new one`);

                    const updated = await tx.resource.update({
                        where: { id: existing.id },
                        data: {
                            name: resource.resource.name,
                            desc: resource.resource.description,
                            version: resource.resource.version,
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
                    t."id",
                    t."tenantId",
                    t."systemId",
                    t."nativeUniqueName",
                    t."version",
                    CASE WHEN t."deletedBy" is NULL THEN tr."name" ELSE r."name"       END AS "name",
                    CASE WHEN t."deletedBy" is NULL THEN tr."desc" ELSE r."desc"       END AS "desc",
                    CASE WHEN t."deletedBy" is NULL THEN NULL      ELSE t."deletedBy"  END AS "deletedBy"
                FROM "stage"."Stage" t
                INNER JOIN "stage"."StagedResource" tr
                    ON t."id" = tr."stageId"
                LEFT JOIN "catalog"."Resource" r
                    ON r."tenantId" = t."tenantId"
                        AND r."systemId" = t."systemId"
                        AND r."nativeUniqueName" = t."nativeUniqueName"
                WHERE
                    tr."stageId" IN (${Prisma.join(stageIds)})
                    AND (
                            t."version" > r."version"
                            OR r."version" is NULL
                        )
            )
            INSERT INTO "catalog"."Resource" (
                "id",
                "tenantId",
                "systemId",
                "nativeUniqueName",
                "version",
                "name",
                "desc",
                "deletedBy"
            )
            SELECT * FROM staged
            ON CONFLICT ("tenantId", "systemId", "nativeUniqueName") WHERE "deletedAt" IS NULL
            DO UPDATE SET
                "version"   = EXCLUDED."version",
                "name"      = EXCLUDED."name",
                "desc"      = EXCLUDED."desc",
                "deletedAt" = CASE WHEN EXCLUDED."deletedBy" is NULL THEN NULL ELSE NOW() END,
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
}

export class StageDatastore {
    private client: DbClient;

    constructor(client: DbClient) {
        this.client = client;
    }

    async stage(ctx: IContext, stagedObjects: IStage[]): Promise<string[]> {
        const stageIds: string[] = [];
        const stages: Prisma.StageCreateManyInput[] = [];
        const stageResources: Prisma.StagedResourceCreateManyInput[] = [];

        stagedObjects.forEach(obj => {
            const id = Generate32UUID();
            stageIds.push(id);

            stages.push({
                id: id,
                tenantId: obj.tenantId,
                systemId: obj.systemId,
                nativeUniqueName: obj.nativeUniqueName,
                version: obj.version,
            });

            stageResources.push({
                stageId: id,
                name: obj.resource.name,
                desc: obj.resource.description,
            });
        });

        // create items first, in case ingest when items are not staged
        await this.client.transaction(ctx, async (tx: PrismaTx) => {
            await tx.stagedResource.createMany({ data: stageResources });
        });

        await this.client.transaction(ctx, async (tx: PrismaTx) => {
            await tx.stage.createMany({ data: stages });
        });

        return stageIds;
    }

    async listStages(ctx: IContext, startFrom?: string, batch?: number): Promise<string[]> {
        batch = batch ?? 500;

        return await this.client.transaction(ctx, async (tx: PrismaTx) => {
            const stages = await tx.stage.findMany({
                where: {
                    ...(startFrom && {
                        id: {
                            gt: startFrom,
                        },
                    }),
                },
                select: {
                    id: true,
                },
                orderBy: {
                    id: 'asc',
                },
                take: batch,
            });

            return stages.map((s: { id: string }) => s.id);
        });
    }

    async delete(ctx: IContext, stageIds: string[]) {
        await this.client.transaction(ctx, async (tx: PrismaTx) => {
            await tx.stage.deleteMany({
                where: {
                    id: {
                        in: stageIds,
                    },
                },
            });
        });

        await this.client.transaction(ctx, async (tx: PrismaTx) => {
            await tx.stagedResource.deleteMany({
                where: {
                    stageId: {
                        in: stageIds,
                    },
                },
            });
        });
    }
}
