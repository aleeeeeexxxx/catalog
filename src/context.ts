/*
 * @author Alex
 */

import { v4 as uuidv4 } from 'uuid';

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
