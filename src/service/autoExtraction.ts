/*
 * @author Alex
 */

import { IContext } from '../context';
import { ResourceDatastore, IResourceToUpdate, Source } from '../dao';
import { getLogger } from '../logger';

const logger = getLogger(__filename);

export class AutoExtractionService {
    private datastore: ResourceDatastore;

    constructor(datastore: ResourceDatastore) {
        this.datastore = datastore;
    }

    async update(ctx: IContext, resource: IResourceToUpdate) {
        logger.info(
            ctx,
            `start to process auto extraction, nativeUniqueName=${resource.resource.nativeUniqueName}`
        );

        resource.source = Source.autoExtraction;
        const ret = await this.datastore.createOrUpdateResource(ctx, resource);

        if (!ret.id) {
            logger.info(ctx, `system does not exist, auto extraction abort`);
        } else {
            logger.info(ctx, `auto extraction completed for ${ret.id}`);
        }
    }
}
