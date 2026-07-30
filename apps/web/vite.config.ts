import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite's built-in esbuild handles the JSX transform, so no React plugin is needed.
  // (Trade-off: no Fast Refresh; a reload picks up changes.)
  esbuild: { jsx: 'automatic' },
  // Local-only tool: everything is served from disk, nothing is fetched remotely.
  server: { port: 5173 },
  test: { environment: 'node', include: ['test/**/*.test.ts', 'test/**/*.test.tsx'] },
});
