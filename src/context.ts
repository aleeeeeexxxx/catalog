/*
 * @author Alex
 */

import { v4 as uuidv4 } from 'uuid';

export const globalTenantId = 'CATALOG_GLOBAL';

export interface IContext {
    correlationId: string;
    tenantId: string;
}

export function createNewContext(tenantId: string): IContext {
    return {
        tenantId,
        correlationId: uuidv4(),
    };
}

export function createGlobalContext(correlationId?: string): IContext {
    return {
        tenantId: globalTenantId,
        correlationId: correlationId ?? uuidv4(),
    };
}
