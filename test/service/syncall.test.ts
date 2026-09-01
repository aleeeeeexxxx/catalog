import { createNewContext } from '../../src/context';
import { IExtractor } from '../../src/extractor';
import { RedisClient, ResourceDatastore, SystemDatastore } from '../../src/infra';
import { AsyncJobService } from '../../src/service/asyncJob';
import { IngestService } from '../../src/service/ingest';
import { SyncAllService, SyncStatus } from '../../src/service/syncall';
import { sleep } from '../../src/utils/time';
import { getRedisClient } from '../setup';

// Mock the extractor module
jest.mock('../../src/extractor', () => ({
    getExtractorBySystemType: jest.fn(),
}));

// Mock the extractor module
jest.mock('../../src/extractor', () => ({
    getExtractorBySystemType: jest.fn(),
}));

let redis: RedisClient;
let taskq: AsyncJobService;
let service: SyncAllService;

// Mock dependencies
let mockResourceStore: jest.Mocked<ResourceDatastore>;
let mockSystemStore: jest.Mocked<SystemDatastore>;
let mockIngest: jest.Mocked<IngestService>;
let mockExtractor: jest.Mocked<IExtractor>;

const { getExtractorBySystemType } = require('../../src/extractor');

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
        } as any;

        mockIngest = {
            stage: jest.fn(),
            countUningested: jest.fn(),
        } as any;

        // Create mock extractor
        mockExtractor = {
            browse: jest.fn(),
            extract: jest.fn(),
            extractBatch: jest.fn(),
        } as any;

        // Setup getExtractorBySystemType to return mock extractor
        getExtractorBySystemType.mockReturnValue(mockExtractor);

        // Initialize service with real taskq and mocked dependencies
        service = new SyncAllService(mockResourceStore, mockSystemStore, taskq, redis, mockIngest);
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
        mockIngest.countUningested.mockResolvedValueOnce(0);

        const workflowId = await service.start(ctx, mockSystemId);

        await sleep(2);

        const status = await service.getWorkflowStatus(ctx, workflowId);
        expect(status.status).toBe(SyncStatus.COMPLETED);

        // Check extractBatch was called with correct parameters
        expect(mockExtractor.extractBatch).toHaveBeenCalledWith(expect.anything(), [
            'resource1',
            'resource3',
        ]);

        // Get stage call parameters and validate
        expect(mockIngest.stage).toHaveBeenCalled();
        const stageCallArgs = mockIngest.stage.mock.calls[0];
        const [_stageCtx, stagedResources] = stageCallArgs;

        expect(stagedResources).toBeDefined();
        expect(stagedResources.length).toBe(1);
        expect(stagedResources[0].nativeUniqueName).toBe('resource5');
    });
});
