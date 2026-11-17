import type { LogEntry, Logger, LogLevel } from './ports.js';

/**
 * Logger estruturado em JSON. O tipo LogEntry só tem campos operacionais
 * (traceId, level, route, status, durationMs); não há campo para dados de paciente (LGPD).
 */
export class JsonLogger implements Logger {
  constructor(private readonly sink: (line: string) => void) {}

  log(entry: LogEntry): void {
    // Serializa só os campos conhecidos, na ordem fixa, para evitar vazamento acidental.
    const { timestamp, level, service, traceId, route, status, durationMs, message } = entry;
    this.sink(JSON.stringify({ timestamp, level, service, traceId, route, status, durationMs, message }));
  }
}

export function levelForStatus(status: number): LogLevel {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}
