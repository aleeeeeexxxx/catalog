const { PrismaClient } = require('./generated/prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgresql://catalog:catalog@10.237.153.61:5432/catalog',
});

pool.on('connect', async (client) => {
    console.log('Setting search_path...');
    await client.query('SET search_path TO "catalog_tenant_catalog_test"');
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({
    adapter,
    log: [
        { emit: 'event', level: 'query' },
    ]
});

prisma.$on('query', (e) => {
    console.log('Query:', e.query);
    console.log('Params:', e.params);
});

async function test() {
    try {
        // First verify search_path
        const result = await prisma.$queryRaw`SHOW search_path`;
        console.log('Current search_path:', result);

        // Then try to query
        const system = await prisma.system.findFirst();
        console.log('Result:', system);
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

test();
