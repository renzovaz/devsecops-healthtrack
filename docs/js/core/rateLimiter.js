export class FixedWindowRateLimiter {
    clock;
    limit;
    windowMs;
    windows = new Map();
    constructor(clock, limit, windowMs) {
        this.clock = clock;
        this.limit = limit;
        this.windowMs = windowMs;
        if (limit < 1 || windowMs < 1)
            throw new Error('limit e windowMs devem ser positivos');
    }
    check(clientKey) {
        const now = this.clock.now();
        let w = this.windows.get(clientKey);
        if (!w || now - w.start >= this.windowMs) {
            w = { start: now, count: 0 };
            this.windows.set(clientKey, w);
        }
        const retryAfterSeconds = Math.ceil((w.start + this.windowMs - now) / 1000);
        if (w.count >= this.limit)
            return { allowed: false, remaining: 0, retryAfterSeconds };
        w.count += 1;
        return { allowed: true, remaining: this.limit - w.count, retryAfterSeconds };
    }
    reset() {
        this.windows.clear();
    }
}
