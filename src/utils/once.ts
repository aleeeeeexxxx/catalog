export class Once<T> {
    private once: Promise<T> | undefined;
    private init: () => Promise<T>;

    constructor(init: () => Promise<T>) {
        this.init = init;
    }

    async get() {
        if (this.once) {
            return await this.once;
        }

        this.once = new Promise((resolve, reject) => {
            this.init().then(resolve).catch(reject);
        });

        return await this.once;
    }
}
