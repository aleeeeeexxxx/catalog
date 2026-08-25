/*
 * @author Alex
 */

export interface IResource {
    nativeUniqueName: string;
    name: string;
    description: string;
    version: string;
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

    metadata: string;

    parents: IStageResource[];
    children: IStageResource[];
}

export const VERSION_REFERENCED_ONLY = -1;
