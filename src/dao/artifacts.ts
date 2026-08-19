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

export interface ISystem {
    uniqueIdentifier: string;
    type: string;
}

export interface IStage {
    tenantId: string;
    systemId: string;
    nativeUniqueName: string;
    version: string;

    resource: IStageResource;
}

export interface IStageResource {
    name: string;
    description: string;
}
