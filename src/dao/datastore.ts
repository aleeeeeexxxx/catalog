/*
 * @author Alex
 */

import { v4 as uuidv4 } from 'uuid';
import { IContext } from '../context';
import { IResource, ISystem, Source } from './artifacts';
import { TenantDbClient, PrismaTx } from './client';
import { Prisma } from '../../generated/prisma/client';
import { getLogger } from '../logger';

const logger = getLogger(__filename);

export interface IResourceToUpdate {
    systemUniqueIdentifier: string;
    resource: IResource;
    source?: Source;
}

export interface IResourceUpdateResult {
    id?: string;
}

export class ResourceDatastore {
    private client: TenantDbClient;

    constructor(client: TenantDbClient) {
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

    async softDelete(ctx: IContext, id: string, tx?: PrismaTx): Promise<boolean> {
        return await this.client.transaction(
            ctx,
            async (tx: PrismaTx) => {
                try {
                    const resource = await tx.resource.update({
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
                        return false;
                    }
                    throw error;
                }

                return true;
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
                            id: uuidv4(),
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
}

export class SystemDatastore {
    private client: TenantDbClient;

    constructor(client: TenantDbClient) {
        this.client = client;
    }

    async create(ctx: IContext, system: ISystem, tx?: PrismaTx): Promise<string> {
        logger.debug(ctx, `create new system, name=${system.uniqueIdentifier}`);

        return await this.client.transaction(
            ctx,
            async (tx: PrismaTx) => {
                const created = await tx.system.create({
                    data: {
                        id: uuidv4(),
                        tenantId: ctx.tenantId,
                        uniqueIdentifier: system.uniqueIdentifier,
                        type: system.type,
                        connection: system.connection,
                    },
                });
                return created.id;
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
                    connection: system.connection,
                };
            },
            tx
        );
    }
}
