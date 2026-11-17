import {
  createSchedulingApp,
  importHmacKey,
  InMemoryAppointmentRepository,
  InMemoryCache,
  InMemoryEventPublisher,
  JsonLogger,
  SystemClock,
  type SchedulingApp,
} from '@healthtrack/core';

export interface Settings {
  jwtSecret: string;
  issuer: string;
  audience: string;
  rateLimit: { limit: number; windowMs: number };
  port: number;
}

/** Lê a configuração do ambiente. O segredo do JWT nunca tem valor padrão. */
export function loadSettings(env: Record<string, string | undefined>): Settings {
  const jwtSecret = env['JWT_SECRET'];
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET ausente ou curto (mínimo de 32 caracteres). Veja o README para gerar um valor local.');
  }
  const int = (name: string, fallback: number) => {
    const v = Number(env[name] ?? fallback);
    if (!Number.isInteger(v) || v < 1) throw new Error(`${name} inválido`);
    return v;
  };
  return {
    jwtSecret,
    issuer: env['JWT_ISSUER'] ?? 'https://auth.healthtrack.example',
    audience: env['JWT_AUDIENCE'] ?? 'healthtrack-api',
    rateLimit: { limit: int('RATE_LIMIT', 20), windowMs: int('RATE_WINDOW_MS', 60_000) },
    port: int('PORT', 3000),
  };
}

export async function buildCore(settings: Settings, sink: (line: string) => void): Promise<SchedulingApp> {
  const jwtKey = await importHmacKey(new TextEncoder().encode(settings.jwtSecret));
  return createSchedulingApp({
    deps: { repo: new InMemoryAppointmentRepository(), cache: new InMemoryCache(), publisher: new InMemoryEventPublisher(), clock: new SystemClock() },
    logger: new JsonLogger(sink),
    jwtKey,
    issuer: settings.issuer,
    audience: settings.audience,
    rateLimit: settings.rateLimit,
  });
}
