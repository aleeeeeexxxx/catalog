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

    async extract(ctx: IContext, resource: IResourceToUpdate) {
        logger.info(ctx, `start to process auto extraction, payload=${JSON.stringify(resource)}`);

        const extractor = getExtractorBySystemType(
            ctx,
            resource.systemType,
            resource.systemUniqueIdentifier
        );
        if (!extractor) {
            logger.warn(
                ctx,
                `no extractor found for systemType=${resource.systemType}, systemUniqueIdentifier=${resource.systemUniqueIdentifier}`
            );
            return;
        }

        logger.debug(ctx, `extractor found, extracting resource: ${resource.nativeUniqueName}`);

        const target = await extractor.extract(ctx, resource.nativeUniqueName);
        logger.debug(
            ctx,
            `extraction completed, resource=${target.metadata.resource.nativeUniqueName}, parents=${target.parents.length}, children=${target.children.length}`
        );

        const stageIds = await this.ingest.stage(ctx, [
            convertExtractedResourceToStage(ctx.tenantId, target),
        ]);

        logger.info(
            ctx,
            `auto extraction completed successfully, stageIds=${JSON.stringify(stageIds)}, resource=${resource.nativeUniqueName}`
        );
    }
}

function convertExtractedResourceToStage(
    tenantId: string,
    resource: IExtractedResource
): IStageResource {
    const stage = {
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
