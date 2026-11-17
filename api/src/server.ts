import { createHttpServer } from './app.js';
import { buildCore, loadSettings } from './config.js';

const settings = loadSettings(process.env);
const core = await buildCore(settings, (line) => process.stdout.write(line + '\n'));
const server = createHttpServer(core).listen(settings.port, () => {
  process.stdout.write(JSON.stringify({ level: 'info', service: 'scheduling-service', message: `listening on ${settings.port}` }) + '\n');
});

// Encerramento gracioso: o ECS envia SIGTERM antes de parar a task.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
