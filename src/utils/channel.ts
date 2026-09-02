export class Channel<T> {
    private waiting: Array<(val: T) => void> = new Array();
    private have: Array<T> = new Array();

    push(val: T) {
        if (this.waiting.length > 0) {
            const resolve = this.waiting[0];
            resolve(val);

            this.waiting = this.waiting.slice(1);
            return;
        }

        this.have.push(val);
    }

    async pull(): Promise<T> {
        if (this.have.length > 0) {
            const ret = this.have[0];
            this.have = this.have.slice(1);

            return ret;
        }

        return new Promise(resolve => {
            this.waiting.push(resolve);
        });
    }
}
