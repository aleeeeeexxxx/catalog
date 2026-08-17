export class Once<T> {
    private once: Promise<T> | undefined;

    async do(fn: () => Promise<T>) {
        if (this.once) {
            return await this.once;
        }

        this.once = new Promise((resolve, reject) => {
            fn().then(resolve).catch(reject);
        });

        return await this.once;
    }
}
