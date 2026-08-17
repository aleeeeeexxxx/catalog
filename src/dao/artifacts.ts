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
