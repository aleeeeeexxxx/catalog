/*
 * @author Alex
 */

import { v4 as uuidv4 } from 'uuid';
import { IContext } from '../context';
import { IResource, ISystem, Source } from './artifacts';
import { TenantDbClient, PrismaTx } from './client';
import { get } from 'node:http';

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

    async getResource(ctx: IContext, id: string, tx?: PrismaTx): Promise<IResource> {
        throw new Error('not implement yet');
    }

    async createOrUpdateResource(
        ctx: IContext,
        resource: IResourceToUpdate,
        tx?: PrismaTx
    ): Promise<IResourceUpdateResult> {
        return await this.client.transaction(ctx, tx, async (tx: PrismaTx) => {
            const system = await tx.system.findFirst({
                where: {
                    tenantId: ctx.tenantId,
                    uniqueIdentifier: resource.systemUniqueIdentifier,
                    deletedAt: null,
                },
            });

            if (!system) {
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

            if (existing.version > resource.resource.version) {
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

            return { id: existing.id };
        });
    }
}

export class SystemDatastore {
    private client: TenantDbClient;

    constructor(client: TenantDbClient) {
        this.client = client;
    }

    async create(ctx: IContext, system: ISystem, tx?: PrismaTx): Promise<string> {
        return await this.client.transaction(ctx, tx, async (tx: PrismaTx) => {
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
        });
    }

    async get(ctx: IContext, id: string, tx?: PrismaTx): Promise<ISystem | null> {
        return await this.client.transaction(ctx, tx, async (tx: PrismaTx) => {
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
        });
    }
}
