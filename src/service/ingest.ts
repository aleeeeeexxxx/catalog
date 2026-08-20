import { IContext } from '../context';
import { ResourceDatastore, StageDatastore } from '../dao';
import { getLogger } from '../logger';

const logger = getLogger(__filename);

export class Ingest {
    private stage: StageDatastore;
    private resource: ResourceDatastore;

    constructor(resource: ResourceDatastore, stage: StageDatastore) {
        this.stage = stage;
        this.resource = resource;
    }

    async flush(ctx: IContext, stageIds: string[]) {
        await this.resource.batchUpsertStage(ctx, stageIds);
        await this.stage.delete(ctx, stageIds);
    }
}
