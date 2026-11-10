import { build } from 'esbuild';
await build({
  entryPoints: ['apps/api/src/server.ts'],
  outfile: 'server-build/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  packages: 'external',
  define: { 'process.env.VERCEL': '"1"' },
  minifySyntax: true,
});
