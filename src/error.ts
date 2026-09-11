export class CatalogError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number = 500,
        public readonly details?: unknown
    ) {
        super(message);
        this.name = 'CatalogError';

        Object.setPrototypeOf(this, new.target.prototype);
    }
}
