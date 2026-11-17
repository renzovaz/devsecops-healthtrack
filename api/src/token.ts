// Gera um JWT de desenvolvimento, assinado com o JWT_SECRET local, para testar a API com curl.
// Uso: JWT_SECRET=... node api/dist/token.js [sub] [scope]
import { importHmacKey, signJwt } from '@healthtrack/core';
import { loadSettings } from './config.js';

const settings = loadSettings(process.env);
const key = await importHmacKey(new TextEncoder().encode(settings.jwtSecret));
const now = Math.floor(Date.now() / 1000);
const token = await signJwt(
  { sub: process.argv[2] ?? 'patient-demo-01', iss: settings.issuer, aud: settings.audience, iat: now, exp: now + 3600, scope: process.argv[3] ?? 'appointments:write' },
  key,
);
process.stdout.write(token + '\n');
