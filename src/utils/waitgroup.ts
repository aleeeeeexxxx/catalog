export class WaitGroup {
    private waitN: number;
    private resolve_: (() => void) | undefined;
    private timeout: number | undefined;

    constructor(timeout?: number) {
        this.waitN = 0;
        this.resolve_ = undefined;
        this.timeout = timeout;
    }

    add(n?: number) {
        n = n ?? 1;
        this.waitN += n;
    }

    done() {
        this.waitN--;
        if (this.waitN === 0) {
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
                setTimeout(reject, this.timeout);
            }
        });
    }
}
