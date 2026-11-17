import { verifyJwt } from './jwt.js';
import { levelForStatus } from './logger.js';
import { FixedWindowRateLimiter } from './rateLimiter.js';
import { createAppointment, getAvailability } from './scheduling.js';
const TRACE_RE = /^[0-9a-f]{32}$/;
export function randomTraceId() {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function statusFor(error) {
    switch (error.kind) {
        case 'validation':
            return 400;
        case 'not_found':
            return 404;
        case 'conflict':
            return 409;
    }
}
export function createSchedulingApp(config) {
    const service = config.serviceName ?? 'scheduling-service';
    const limiter = new FixedWindowRateLimiter(config.deps.clock, config.rateLimit.limit, config.rateLimit.windowMs);
    const newTraceId = config.newTraceId ?? randomTraceId;
    async function handle(req) {
        const started = config.deps.clock.now();
        const incoming = req.headers['x-trace-id'];
        const traceId = incoming && TRACE_RE.test(incoming) ? incoming : newTraceId();
        const route = `${req.method.toUpperCase()} ${req.path}`;
        const finish = (status, body, message, extra = {}) => {
            const log = {
                timestamp: new Date(config.deps.clock.now()).toISOString(),
                level: levelForStatus(status),
                service,
                traceId,
                route,
                status,
                durationMs: config.deps.clock.now() - started,
                message,
            };
            config.logger.log(log);
            const result = { status, headers: { 'x-trace-id': traceId, ...(extra.headers ?? {}) }, body, log };
            if (extra.event)
                result.event = extra.event;
            return result;
        };
        try {
            const method = req.method.toUpperCase();
            if (req.path === '/health') {
                return method === 'GET' ? finish(200, { status: 'ok' }, 'health check') : finish(405, { error: 'method_not_allowed' }, 'method not allowed');
            }
            const isAvailability = req.path === '/v1/availability';
            const isAppointments = req.path === '/v1/appointments';
            if (!isAvailability && !isAppointments)
                return finish(404, { error: 'not_found' }, 'route not found');
            if ((isAvailability && method !== 'GET') || (isAppointments && method !== 'POST')) {
                return finish(405, { error: 'method_not_allowed' }, 'method not allowed');
            }
            // 1a. edge: throttling (papel do API Gateway)
            const decision = limiter.check(req.clientKey);
            if (!decision.allowed) {
                return finish(429, { error: 'too_many_requests' }, 'rate limit exceeded', { headers: { 'retry-after': String(decision.retryAfterSeconds) } });
            }
            // 1b. edge: autorizador JWT (papel do API Gateway), executado uma única vez
            const auth = req.headers['authorization'];
            const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
            if (!token)
                return finish(401, { error: 'unauthorized' }, 'jwt rejected: missing_token', { headers: { 'www-authenticate': 'Bearer' } });
            const verified = await verifyJwt(token, config.jwtKey, { issuer: config.issuer, audience: config.audience, nowMs: config.deps.clock.now() });
            // A resposta é genérica; o motivo fica só no log (não ajuda um atacante).
            if (!verified.ok)
                return finish(401, { error: 'unauthorized' }, `jwt rejected: ${verified.reason}`, { headers: { 'www-authenticate': 'Bearer' } });
            const identity = verified.claims;
            // 2. scheduling-service
            if (isAvailability) {
                const r = await getAvailability(config.deps, req.query['doctorId'], req.query['date']);
                if (!r.ok)
                    return finish(statusFor(r.error), { error: r.error.kind, message: r.error.message }, `availability failed: ${r.error.kind}`);
                return finish(200, r.value, `availability served from ${r.value.source}`);
            }
            const scopes = typeof identity.scope === 'string' ? identity.scope.split(' ') : [];
            if (!scopes.includes('appointments:write'))
                return finish(403, { error: 'forbidden' }, 'missing scope appointments:write');
            const body = (req.body ?? {});
            if (typeof body !== 'object' || Array.isArray(body))
                return finish(400, { error: 'validation', message: 'corpo deve ser um objeto JSON' }, 'invalid body');
            const r = await createAppointment(config.deps, { doctorId: body['doctorId'], date: body['date'], time: body['time'] }, identity.sub, traceId);
            if (!r.ok)
                return finish(statusFor(r.error), { error: r.error.kind, message: r.error.message }, `appointment rejected: ${r.error.kind}`);
            const { appointmentId, doctorId, date, time } = r.value.appointment;
            return finish(201, { appointmentId, doctorId, date, time, status: 'CONFIRMED' }, 'appointment created', {
                headers: { location: `/v1/appointments/${appointmentId}` },
                event: r.value.event,
            });
        }
        catch {
            return finish(500, { error: 'internal_error' }, 'unexpected error');
        }
    }
    return { handle, resetRateLimit: () => limiter.reset() };
}
