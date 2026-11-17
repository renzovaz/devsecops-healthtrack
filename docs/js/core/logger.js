/**
 * Logger estruturado em JSON. O tipo LogEntry só tem campos operacionais
 * (traceId, level, route, status, durationMs); não há campo para dados de paciente (LGPD).
 */
export class JsonLogger {
    sink;
    constructor(sink) {
        this.sink = sink;
    }
    log(entry) {
        // Serializa só os campos conhecidos, na ordem fixa, para evitar vazamento acidental.
        const { timestamp, level, service, traceId, route, status, durationMs, message } = entry;
        this.sink(JSON.stringify({ timestamp, level, service, traceId, route, status, durationMs, message }));
    }
}
export function levelForStatus(status) {
    if (status >= 500)
        return 'error';
    if (status >= 400)
        return 'warn';
    return 'info';
}
