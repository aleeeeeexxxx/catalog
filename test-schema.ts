import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const schema = 'catalog_tenant_catalog_test';

// Correct way to set search_path in PostgreSQL connection
const pool = new Pool({
    host: '10.237.153.61',
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    database: 'catalog',
    // This sets search_path at connection level
    options: `-c search_path=${schema}`,
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
    adapter,
    log: [{ emit: 'stdout', level: 'query' }],
});

async function test() {
    try {
        console.log('=== Testing search_path ===');
        const result = await prisma.$queryRaw`SHOW search_path`;
        console.log('search_path:', result);

        console.log('\n=== Testing Prisma query ===');
        const systems = await prisma.system.findMany({ take: 1 });
        console.log('Result:', systems);
    } catch (e: any) {
        console.error('Error:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

test();
