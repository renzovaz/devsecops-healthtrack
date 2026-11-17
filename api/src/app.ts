import express, { type NextFunction, type Request, type Response } from 'express';
import type { HttpRequest, SchedulingApp } from '@healthtrack/core';

/**
 * Adapter HTTP fino: traduz Express <-> HttpRequest/HttpResult do núcleo.
 * Toda a regra (rate limit, JWT, agendamento, logs) está em @healthtrack/core.
 */
export function createHttpServer(core: SchedulingApp) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '10kb' }));

  app.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
      const query: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.query)) query[k] = typeof v === 'string' ? v : undefined;
      const request: HttpRequest = { method: req.method, path: req.path, query, headers, body: req.body, clientKey: req.ip ?? 'unknown' };
      const result = await core.handle(request);
      res.status(result.status).set(result.headers).json(result.body);
    } catch (err) {
      next(err);
    }
  });

  // JSON malformado ou corpo grande demais chegam aqui antes do núcleo.
  app.use((err: { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status === 413 ? 413 : err.type === 'entity.parse.failed' ? 400 : 500;
    res.status(status).json({ error: status === 500 ? 'internal_error' : 'invalid_request' });
  });

  return app;
}
