export function createAutoMock<T extends object>(
    ClassOrPrototype: new (...args: any[]) => T | T
): jest.Mocked<T> {
    const prototype =
        typeof ClassOrPrototype === 'function' ? ClassOrPrototype.prototype : ClassOrPrototype;

    const mock: any = {};

    const propertyNames = Object.getOwnPropertyNames(prototype);

    for (const key of propertyNames) {
        if (key === 'constructor') continue;

        const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
        if (descriptor && typeof descriptor.value === 'function') {
            mock[key] = jest.fn();
        }
    }

    return mock as jest.Mocked<T>;
}
