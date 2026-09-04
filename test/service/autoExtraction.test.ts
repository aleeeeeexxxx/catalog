import { createNewContext } from '../../src/context';
import { getExtractorBySystemType, IExtractor } from '../../src/extractor';
import {
    DbClient,
    RedisClient,
    RelationshipDatastore,
    ResourceDatastore,
    StageDatastore,
    SystemDatastore,
} from '../../src/dao';
import { AsyncJobService } from '../../src/service/asyncJob';
import { AutoExtractionService } from '../../src/service/autoExtraction';
import { IngestService } from '../../src/service/ingest';
import { sleep } from '../../src/utils/time';
import { getRedisClient, getTestDbClient } from '../setup';

// Mock the extractor module
jest.mock('../../src/extractor', () => ({
    getExtractorBySystemType: jest.fn(),
}));
// Mock dependencies
let mockExtractor: jest.Mocked<IExtractor>;

let redis: RedisClient;
let taskq: AsyncJobService;
let service: AutoExtractionService;
let ingest: IngestService;
let db: DbClient;
let resourceStore: ResourceDatastore;
let systemStore: SystemDatastore;
let stageStore: StageDatastore;
let relationshipStore: RelationshipDatastore;

describe('Auto extraction', () => {
    beforeAll(async () => {
        // Create mock extractor
        mockExtractor = {
            browse: jest.fn(),
            extract: jest.fn(),
            extractBatch: jest.fn(),
        } as any;

        // Setup getExtractorBySystemType to return mock extractor
        (getExtractorBySystemType as jest.Mock).mockReturnValue(mockExtractor);

        redis = await getRedisClient();
        taskq = new AsyncJobService(redis);

        db = await getTestDbClient();
        resourceStore = new ResourceDatastore(db);
        systemStore = new SystemDatastore(db);
        stageStore = new StageDatastore(db);
        relationshipStore = new RelationshipDatastore(db);

        // Initialize IngestService with real datastores
        ingest = new IngestService(
            stageStore,
            resourceStore,
            systemStore,
            relationshipStore,
            taskq,
            redis,
            1,
            1
        );

        // Initialize service with real datastores
        service = new AutoExtractionService(ingest);
    });

    it('delete', async () => {
        const mockSystemId = 'auto-delete-system-id';
        const mockSystemType = 'SAC';
        const mockTenantId = 'auto-delete-tenant-id';
        const ctx = createNewContext(mockTenantId);

        await db.prisma.system.create({
            data: {
                id: mockSystemId,
                tenantId: mockTenantId,
                type: mockSystemType,
                uniqueIdentifier: 'starkiller-hc-ttm',
            },
        });
        await db.prisma.resource.create({
            data: {
                nativeUniqueName: 'resource1',
                version: 3,
                tenantId: mockTenantId,
                id: 'resource1',
                systemId: mockSystemId,
                metadata: '{"name": "resource1"}',
            },
        });

        await service.extract(ctx, {
            nativeUniqueName: 'resource1',
            version: 3,
            systemType: mockSystemType,
            systemUniqueIdentifier: 'starkiller-hc-ttm',
            type: 'delete',
        });

        await sleep(1);

        const deleted = await resourceStore.getResource(ctx, 'resource1');
        expect(deleted).toBeNull();
    });
});
