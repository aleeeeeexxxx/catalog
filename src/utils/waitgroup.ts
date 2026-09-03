export class WaitGroup {
    private waitN: number;
    private resolve_: (() => void) | undefined;
    private timeout: number | undefined;
    private timeoutId: NodeJS.Timeout | undefined;

    constructor(timeout?: number) {
        this.waitN = 0;
        this.resolve_ = undefined;
        this.timeout = timeout;
        this.timeoutId = undefined;
    }

    add(n?: number) {
        n = n ?? 1;
        this.waitN += n;
    }

    done() {
        this.waitN--;
        if (this.waitN === 0) {
            this.clearTimeout();
            this.resolve_?.();
        }
    }

    wait(): Promise<void> {
        if (this.waitN === 0) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            this.resolve_ = resolve;

            if (this.timeout) {
                this.timeoutId = setTimeout(() => {
                    this.timeoutId = undefined;

                    reject('waitgroup timeout');
                }, this.timeout);
            }
        });
    }

    private clearTimeout() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
        }
    }
}
