import { convertToHashTable, convertFromHashTable } from '../../src/dao/redis/client';

describe('Redis Hash Table Conversion', () => {
    describe('convertToHashTable', () => {
        it('should convert string values', () => {
            const obj = { name: 'test', type: 'unit' };
            const result = convertToHashTable(obj);

            expect(result).toEqual({
                name: 'test',
                type: 'unit',
            });
        });

        it('should convert number values to strings', () => {
            const obj = { count: 42, price: 99.99 };
            const result = convertToHashTable(obj);

            expect(result).toEqual({
                count: '42',
                price: '99.99',
            });
        });

        it('should convert boolean values to strings', () => {
            const obj = { active: true, deleted: false };
            const result = convertToHashTable(obj);

            expect(result).toEqual({
                active: 'true',
                deleted: 'false',
            });
        });

        it('should convert Date to ISO string', () => {
            const date = new Date('2024-01-15T10:30:00.000Z');
            const obj = { createdAt: date };
            const result = convertToHashTable(obj);

            expect(result).toEqual({
                createdAt: '2024-01-15T10:30:00.000Z',
            });
        });

        it('should JSON stringify objects', () => {
            const obj = {
                metadata: { key: 'value', nested: { count: 10 } },
                tags: ['tag1', 'tag2'],
            };
            const result = convertToHashTable(obj);

            expect(result).toEqual({
                metadata: '{"key":"value","nested":{"count":10}}',
                tags: '["tag1","tag2"]',
            });
        });

        it('should skip null and undefined values', () => {
            const obj = { name: 'test', nullValue: null, undefinedValue: undefined };
            const result = convertToHashTable(obj);

            expect(result).toEqual({
                name: 'test',
            });
        });

        it('should handle mixed types', () => {
            const obj = {
                id: 'abc123',
                count: 100,
                active: true,
                createdAt: new Date('2024-01-01T00:00:00.000Z'),
                data: { foo: 'bar' },
                nullField: null,
            };
            const result = convertToHashTable(obj);

            expect(result).toEqual({
                id: 'abc123',
                count: '100',
                active: 'true',
                createdAt: '2024-01-01T00:00:00.000Z',
                data: '{"foo":"bar"}',
            });
        });
    });

    describe('convertFromHashTable', () => {
        it('should parse JSON objects', () => {
            const hash = {
                metadata: '{"key":"value","nested":{"count":10}}',
            };
            const result = convertFromHashTable<{ metadata: any }>(hash);

            expect(result.metadata).toEqual({ key: 'value', nested: { count: 10 } });
        });

        it('should parse JSON arrays', () => {
            const hash = {
                tags: '["tag1","tag2","tag3"]',
            };
            const result = convertFromHashTable<{ tags: string[] }>(hash);

            expect(result.tags).toEqual(['tag1', 'tag2', 'tag3']);
        });

        it('should parse ISO date strings to Date objects', () => {
            const hash = {
                createdAt: '2024-01-15T10:30:00.000Z',
            };
            const result = convertFromHashTable<{ createdAt: Date }>(hash);

            expect(result.createdAt).toBeInstanceOf(Date);
            expect(result.createdAt.toISOString()).toBe('2024-01-15T10:30:00.000Z');
        });

        it('should parse number strings to numbers', () => {
            const hash = {
                count: '42',
                price: '99.99',
                negative: '-10',
            };
            const result = convertFromHashTable<{ count: number; price: number; negative: number }>(
                hash
            );

            expect(result.count).toBe(42);
            expect(result.price).toBe(99.99);
            expect(result.negative).toBe(-10);
        });

        it('should parse boolean strings to booleans', () => {
            const hash = {
                active: 'true',
                deleted: 'false',
            };
            const result = convertFromHashTable<{ active: boolean; deleted: boolean }>(hash);

            expect(result.active).toBe(true);
            expect(result.deleted).toBe(false);
        });

        it('should keep regular strings as strings', () => {
            const hash = {
                name: 'test',
                type: 'unit',
            };
            const result = convertFromHashTable<{ name: string; type: string }>(hash);

            expect(result.name).toBe('test');
            expect(result.type).toBe('unit');
        });

        it('should handle mixed types', () => {
            const hash = {
                id: 'abc123',
                count: '100',
                active: 'true',
                createdAt: '2024-01-01T00:00:00.000Z',
                data: '{"foo":"bar"}',
            };
            const result = convertFromHashTable<{
                id: string;
                count: number;
                active: boolean;
                createdAt: Date;
                data: any;
            }>(hash);

            expect(result.id).toBe('abc123');
            expect(result.count).toBe(100);
            expect(result.active).toBe(true);
            expect(result.createdAt).toBeInstanceOf(Date);
            expect(result.data).toEqual({ foo: 'bar' });
        });

        it('should handle malformed JSON gracefully', () => {
            const hash = {
                validJson: '{"key":"value"}',
                invalidJson: '{not valid json}',
            };
            const result = convertFromHashTable<{ validJson: any; invalidJson: string }>(hash);

            expect(result.validJson).toEqual({ key: 'value' });
            expect(result.invalidJson).toBe('{not valid json}'); // 保留为字符串
        });
    });

    describe('Round-trip conversion', () => {
        it('should preserve data through round-trip conversion', () => {
            const original = {
                id: 'test123',
                count: 42,
                active: true,
                createdAt: new Date('2024-01-15T10:30:00.000Z'),
                metadata: { key: 'value', nested: { count: 10 } },
                tags: ['tag1', 'tag2'],
            };

            const hash = convertToHashTable(original);
            const restored = convertFromHashTable<typeof original>(hash);

            expect(restored.id).toBe(original.id);
            expect(restored.count).toBe(original.count);
            expect(restored.active).toBe(original.active);
            expect(restored.createdAt).toEqual(original.createdAt);
            expect(restored.metadata).toEqual(original.metadata);
            expect(restored.tags).toEqual(original.tags);
        });
    });
});
