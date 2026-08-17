/*
 * @author Alex
 */

import { v4 as uuidv4 } from 'uuid';
import { IContext } from '../context';
import { IResource, Source } from './artifacts';
import { TenantDbClient, PrismaTx } from './client';

export interface IResourceToUpdate {
    systemUniqueIdentifier: string;
    resource: IResource;
    source?: Source;
}

export interface IResourceUpdateResult {
    id?: string;
}

export class Datastore {
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
