// Bundles the Electron main process — the server and every workspace package it
// imports included — into one CommonJS file, so the packaged app ships no
// node_modules at all and pnpm's symlinked layout never reaches electron-builder.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'out/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  // electron is provided by the runtime; the other two are optional native speedups
  // `ws` tries to load and falls back without.
  external: ['electron', 'bufferutil', 'utf-8-validate'],
  logLevel: 'info',
});
