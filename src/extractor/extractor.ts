import { IContext } from '../context';
import { IResource, ISystem } from '../infra';

export interface IExtractedMetadata {
    resource: IResource;
    system: ISystem;
}

export interface IExtractedResource {
    metadata: IExtractedMetadata;

    parents: IExtractedMetadata[];
    children: IExtractedMetadata[];
}

export interface IBrowseResult {
    nativeUniqueName: string;
    version: number;
}

export interface IExtractor {
    extract(ctx: IContext, nativeUniqueName: string): Promise<IExtractedResource>;

    browse(ctx: IContext, systemUniqueId: string): Promise<IBrowseResult[]>;
    extractBatch(ctx: IContext, nativeUniqueName: string[]): Promise<IExtractedResource[]>;
}

export function getExtractorBySystemType(
    ctx: IContext,
    type: string,
    systemUniqueIdentifier: string
): IExtractor | null {
    return null;
}
