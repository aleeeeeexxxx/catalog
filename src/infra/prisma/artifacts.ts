/*
 * @author Alex
 */

export interface IResource {
    nativeUniqueName: string;
    version: number;
    metadata: string;
}

export const enum Source {
    autoExtraction = 'autoExtraction',
}

export const enum Relationship {
    dependon = 'dependon',
}

export interface ISystem {
    uniqueIdentifier: string;
    type: string;
}

export interface IStageResource {
    tenantId: string;
    nativeUniqueName: string;
    version: number;
    system: ISystem;

    metadata: any;

    parents: IStageResource[];
    children: IStageResource[];
}

export const VERSION_REFERENCED_ONLY = -1;
