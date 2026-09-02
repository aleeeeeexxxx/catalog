/*
 * @author Alex
 */

export interface IResource {
    nativeUniqueName: string;
    version: number;
    metadata: any;
}

export const enum Source {
    autoExtraction = 'autoExtraction',
}

export const enum Relationship {
    dependon = 'dependon',
}

export interface ISystem extends IStageSystem {
    id: string;
}

// export interface ISystem

export interface IStageSystem {
    uniqueIdentifier: string;
    type: string;
}

export interface IStageResource {
    workflowId?: string;

    tenantId: string;
    nativeUniqueName: string;
    version: number;
    system: IStageSystem;

    deletedBy?: string;
    metadata: any;

    parents?: IStageResource[];
    children?: IStageResource[];
}

export const VERSION_REFERENCED_ONLY = -1;
