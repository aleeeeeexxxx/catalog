/*
 * @author Alex
 */

import { Datastore } from '../../src/dao';
import { getSharedTestContext, getTestTenantDbClient } from '../setup';

const ctx = getSharedTestContext();
let datastore: Datastore;

beforeAll(async () => {
    datastore = new Datastore(await getTestTenantDbClient());
});

describe('TestDatastore', () => {
    it('createOrUpdateResource', async () => {
        const result = await datastore.createOrUpdateResource(ctx, {
            systemUniqueIdentifier: 'test-system',
            resource: {
                nativeUniqueName: 'createOrUpdateResource',
                name: 'name',
                description: 'description',
                version: '1.0',
            },
        });

        expect(result.id).toBeDefined();
    });
});
