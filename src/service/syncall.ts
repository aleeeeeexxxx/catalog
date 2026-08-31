import { IContext } from '../context';
import { SystemDatastore } from '../infra';
import { Generate32UUID } from '../utils/uuid';

const errorSystemNotExist = new Error('system not exist');

export class SyncAllService {
    private systemStore: SystemDatastore;

    constructor(systemStore: SystemDatastore) {
        this.systemStore = systemStore;
    }

    async start(ctx: IContext, systemId: string): Promise<string> {
        const target = await this.systemStore.get(ctx, systemId);
        if (!target) {
            throw errorSystemNotExist;
        }

        const jobId = Generate32UUID();
        return jobId;
    }

    async handleBrowse(ctx: IContext, systemId: string) {}

    async handleExtract(ctx: IContext, systemId: string, nativeUniqueNames: string[]) {}

    async getStatus(ctx: IContext, jobId: string) {}
}
