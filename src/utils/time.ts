export const SECOND = 1000;
export const MINUTE = 60 * SECOND;

export async function sleep(n: number) {
    await new Promise(resolve => setTimeout(resolve, n * SECOND));
}
