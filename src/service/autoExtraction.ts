/*
 * @author Alex
 */

import { IContext } from '../context';
import { getExtractorBySystemType, IExtractedResource } from '../extractor';
import { IStageResource, VERSION_REFERENCED_ONLY } from '../infra';
import { getLogger } from '../logger';
import { IngestService } from './ingest';

const logger = getLogger(__filename);

export interface IResourceToUpdate {
    type: 'update' | 'delete';

    nativeUniqueName: string;
    version: number;

    systemType: string;
    systemUniqueIdentifier: string;
}

export class AutoExtractionService {
    private ingest: IngestService;

    constructor(ingest: IngestService) {
        this.ingest = ingest;
    }

    async extract(ctx: IContext, event: IResourceToUpdate) {
        logger.info(ctx, `start to process auto extraction, payload=${JSON.stringify(event)}`);

        const extractor = getExtractorBySystemType(
            ctx,
            event.systemType,
            event.systemUniqueIdentifier
        );
        if (!extractor) {
            logger.warn(
                ctx,
                `no extractor found for systemType=${event.systemType}, systemUniqueIdentifier=${event.systemUniqueIdentifier}`
            );
            return;
        }

        logger.debug(ctx, `extractor found, processing resource: ${event.nativeUniqueName}`);

        const resources: IStageResource[] = [];
        if (event.type === 'update') {
            const target = await extractor.extract(ctx, event.nativeUniqueName);
            logger.debug(
                ctx,
                `extraction completed, resource=${target.metadata.resource.nativeUniqueName}, parents=${target.parents.length}, children=${target.children.length}`
            );
            resources.push(convertExtractedResourceToStage(ctx.tenantId, target));
        } else {
            resources.push({
                tenantId: ctx.tenantId,
                nativeUniqueName: event.nativeUniqueName,
                version: event.version,
                metadata: null,
                system: { type: event.systemType, uniqueIdentifier: event.systemUniqueIdentifier },
                deletedAt: new Date(),
            });
        }

        const stageIds = await this.ingest.stage(ctx, resources);

        logger.info(
            ctx,
            `auto extraction completed successfully, stageIds=${JSON.stringify(stageIds)}, resource=${event.nativeUniqueName}`
        );
    }
}

export function convertExtractedResourceToStage(
    tenantId: string,
    resource: IExtractedResource,
    workflowId?: string
): IStageResource {
    const stage = {
        workflowId,
        tenantId,
        ...resource.metadata.resource,
        system: resource.metadata.system,

        parents: resource.parents.map(item => {
            return {
                ...item.resource,
                system: item.system,
                tenantId,
                version: VERSION_REFERENCED_ONLY,
            };
        }),
        children: resource.children.map(item => {
            return {
                ...item.resource,
                system: item.system,
                tenantId,
                version: VERSION_REFERENCED_ONLY,
            };
        }),
    };

    return stage;
}
