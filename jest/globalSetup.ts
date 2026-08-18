import { clearTestDb } from '../test/setup';

export default async function () {
    console.log('\n===================  GLOBAL SETUP START ===================\n');

    await clearTestDb();

    console.log('\n===================  GLOBAL SETUP END   ===================\n');
}
