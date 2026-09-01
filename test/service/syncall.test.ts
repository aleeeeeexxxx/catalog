import { createNewContext } from '../../src/context';
import { IExtractor } from '../../src/extractor';
import {
    RedisClient,
    RelationshipDatastore,
    ResourceDatastore,
    StageDatastore,
    SystemDatastore,
} from '../../src/infra';
import { AsyncJobService } from '../../src/service/asyncJob';
import { IngestService } from '../../src/service/ingest';
import { SyncAllService, SyncStatus } from '../../src/service/syncall';
import { sleep } from '../../src/utils/time';
import { getRedisClient } from '../setup';
import { getExtractorBySystemType } from '../../src/extractor';

// Mock the extractor module
jest.mock('../../src/extractor', () => ({
    getExtractorBySystemType: jest.fn(),
}));

let redis: RedisClient;
let taskq: AsyncJobService;
let service: SyncAllService;
let ingest: IngestService;

// Mock dependencies
let mockResourceStore: jest.Mocked<ResourceDatastore>;
let mockSystemStore: jest.Mocked<SystemDatastore>;
let mockStageStore: jest.Mocked<StageDatastore>;
let mockRelationshipStore: jest.Mocked<RelationshipDatastore>;
let mockExtractor: jest.Mocked<IExtractor>;

describe('Sync all service', () => {
    beforeAll(async () => {
        redis = await getRedisClient();

        // Create real taskq instance
        taskq = new AsyncJobService(redis);

        // Create mocks for other dependencies
        mockResourceStore = {
            get: jest.fn(),
            getResourceVersions: jest.fn(),
        } as any;

        mockSystemStore = {
            get: jest.fn(),
            batchUpsertFromStage: jest.fn(),
        } as any;

        mockStageStore = {
            stage: jest.fn(),
            getPendingStages: jest.fn(),
            delete: jest.fn(),
            countStagesByWorkflowId: jest.fn(),
        } as any;

        mockRelationshipStore = {
            batchUpsertStage: jest.fn(),
        } as any;

        // Create mock extractor
        mockExtractor = {
            browse: jest.fn(),
            extract: jest.fn(),
            extractBatch: jest.fn(),
        } as any;

        // Setup getExtractorBySystemType to return mock extractor
        (getExtractorBySystemType as jest.Mock).mockReturnValue(mockExtractor);

        // Initialize IngestService with mocks
        ingest = new IngestService(
            mockStageStore,
            mockResourceStore,
            mockSystemStore,
            mockRelationshipStore,
            taskq,
            redis,
            1,
            1
        );

        // Initialize service with real taskq and mocked dependencies
        service = new SyncAllService(mockResourceStore, mockSystemStore, taskq, redis, ingest);
    });

    it('sync all should complete', async () => {
        const mockSystemId = 'mock-system-id';
        const ctx = createNewContext('sync all should complete');

        mockSystemStore.get.mockResolvedValueOnce({ type: 'SAC', uniqueIdentifier: '123' });
        mockExtractor.browse.mockResolvedValueOnce([
            { nativeUniqueName: 'resource1', version: 1 },
            { nativeUniqueName: 'resource2', version: 2 },
            { nativeUniqueName: 'resource3', version: 3 },
            { nativeUniqueName: 'resource4', version: 4 },
        ]);
        mockResourceStore.getResourceVersions.mockResolvedValueOnce([
            { nativeUniqueName: 'resource2', version: 3 },
            { nativeUniqueName: 'resource3', version: 2 },
            { nativeUniqueName: 'resource4', version: 4 },
            { nativeUniqueName: 'resource5', version: 4 },
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
            'resource3',
        ]);
    });
});
