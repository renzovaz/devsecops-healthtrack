// Copia o JS gerado pelo tsc (core/dist) para docs/js/core, que é commitado e servido pelo GitHub Pages.
// O job "core-drift" do CI roda este script e falha se o resultado diferir do que está commitado.
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const src = new URL('../core/dist/', import.meta.url);
const dest = new URL('../docs/js/core/', import.meta.url);
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true, filter: (p) => !p.endsWith('.d.ts') });
console.log('core/dist -> docs/js/core');
