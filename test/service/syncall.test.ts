import { createNewContext } from '../../src/context';
import { IExtractor } from '../../src/extractor';
import {
    DbClient,
    RedisClient,
    RelationshipDatastore,
    ResourceDatastore,
    StageDatastore,
    SystemDatastore,
    VERSION_REFERENCED_ONLY,
} from '../../src/dao';
import { AsyncJobService } from '../../src/service/asyncJob';
import { IngestService } from '../../src/service/ingest';
import { SyncAllService, SyncStatus } from '../../src/service/syncall';
import { sleep } from '../../src/utils/time';
import { getRedisClient, getTestDbClient } from '../setup';
import { getExtractorBySystemType } from '../../src/extractor';

// Mock the extractor module
jest.mock('../../src/extractor', () => ({
    getExtractorBySystemType: jest.fn(),
}));
// Mock dependencies
let mockExtractor: jest.Mocked<IExtractor>;

let redis: RedisClient;
let taskq: AsyncJobService;
let service: SyncAllService;
let ingest: IngestService;
let db: DbClient;
let resourceStore: ResourceDatastore;
let systemStore: SystemDatastore;
let stageStore: StageDatastore;
let relationshipStore: RelationshipDatastore;

describe('Sync all workflow', () => {
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
        service = new SyncAllService(resourceStore, systemStore, taskq, redis, ingest);
    });

    it('sync all should complete', async () => {
        const mockSystemId = 'mock-system-id-for-sync-all';
        const mockTenantId = 'sync all should complete';
        const mockSystemType = 'SAC';
        const ctx = createNewContext(mockTenantId);

        await db.prisma.system.create({
            data: {
                id: mockSystemId,
                tenantId: mockTenantId,
                type: mockSystemType,
                uniqueIdentifier: 'starkiller-hc-deepsea',
            },
        });
        await db.prisma.resource.createMany({
            data: [
                {
                    nativeUniqueName: 'resource2',
                    version: 3,
                    tenantId: mockTenantId,
                    id: 'resource2',
                    systemId: mockSystemId,
                    metadata: '{}',
                },
                {
                    nativeUniqueName: 'resource3',
                    version: 3,
                    tenantId: mockTenantId,
                    id: 'resource3',
                    systemId: mockSystemId,
                    metadata: '{}',
                },
                {
                    nativeUniqueName: 'resource4',
                    version: 3,
                    tenantId: mockTenantId,
                    id: 'resource4',
                    systemId: mockSystemId,
                    metadata: '{}',
                },
                {
                    nativeUniqueName: 'resource5',
                    version: 5,
                    tenantId: mockTenantId,
                    id: 'resource5',
                    systemId: mockSystemId,
                    metadata: '{}',
                },
                {
                    nativeUniqueName: 'resource6',
                    version: VERSION_REFERENCED_ONLY,
                    tenantId: mockTenantId,
                    id: 'resource6',
                    systemId: mockSystemId,
                    metadata: '{}',
                },
            ],
        });

        mockExtractor.browse.mockResolvedValueOnce([
            { nativeUniqueName: 'resource1', version: 1 },
            { nativeUniqueName: 'resource2', version: 2 },
            { nativeUniqueName: 'resource3', version: 3 },
            { nativeUniqueName: 'resource4', version: 4 },
        ]);
        mockExtractor.extractBatch.mockResolvedValueOnce([
            {
                metadata: {
                    resource: {
                        nativeUniqueName: 'resource1',
                        version: 1,
                        metadata: { name: 'resource1' },
                    },
                    system: {
                        type: 'SAC',
                        uniqueIdentifier: '123',
                    },
                },
                parents: [],
                children: [],
            },
        ]);

        const workflowId = await service.start(ctx, mockSystemId);

        await sleep(2);

        const status = await service.getWorkflowStatus(ctx, workflowId);
        expect(status.status).toBe(SyncStatus.COMPLETED);

        // Check extractBatch was called with correct parameters
        expect(mockExtractor.extractBatch).toHaveBeenCalledWith(expect.anything(), [
            'resource1',
            'resource4',
        ]);

        const referencedOnly = await resourceStore.getResource(ctx, 'resource6');
        expect(referencedOnly).not.toBeNull();
    });
});
