#!/usr/bin/env node
// Runs the built server when the package carries one (a release), and the
// TypeScript source otherwise (an install of main), which Node 24 runs as is.
try {
  await import('../dist/index.js');
} catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  await import('../src/index.ts');
}
