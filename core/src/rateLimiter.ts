import type { Clock } from './ports.js';

/**
 * Limite de requisições por cliente em janela fixa. No estudo, o throttling é feito
 * pelo API Gateway (seção 6.2); aqui ele roda no módulo edge, que faz esse papel localmente.
 */
export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly clock: Clock,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    if (limit < 1 || windowMs < 1) throw new Error('limit e windowMs devem ser positivos');
  }

  check(clientKey: string): RateLimitDecision {
    const now = this.clock.now();
    let w = this.windows.get(clientKey);
    if (!w || now - w.start >= this.windowMs) {
      w = { start: now, count: 0 };
      this.windows.set(clientKey, w);
    }
    const retryAfterSeconds = Math.ceil((w.start + this.windowMs - now) / 1000);
    if (w.count >= this.limit) return { allowed: false, remaining: 0, retryAfterSeconds };
    w.count += 1;
    return { allowed: true, remaining: this.limit - w.count, retryAfterSeconds };
  }

  reset(): void {
    this.windows.clear();
  }
}
