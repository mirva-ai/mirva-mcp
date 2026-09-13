/**
 * Repeated captures of one board view, region by region and zoom by zoom,
 * through one persistent client: the cost and reliability of rendering a
 * board an agent is working on, run after run. Each run appends one JSON
 * line to the log so runs can be compared over a night.
 *
 *   MIRVA_URL=... MIRVA_API_KEY=... node tools/soak.mjs <boardId> <x> <y> <w> <h> [rounds] [logFile]
 */
import { appendFileSync } from 'fs';
import { credentialsFromEnv, MirvaClient } from '../src/transport.mjs';

const [board, xs, ys, ws, hs, roundsArg, logFile] = process.argv.slice(2);
const view = { x: Number(xs), y: Number(ys), w: Number(ws), h: Number(hs) };
const rounds = Number(roundsArg || 3);
const client = new MirvaClient({ url: process.env.MIRVA_URL || 'http://localhost:4000', ...credentialsFromEnv() });

/** The view whole, its four quarters, and four close-ups a quarter of a quarter wide, each at the viewer's usual size. */
function regions() {
  const out = [{ label: 'whole', rect: view, maxDim: 1400 }];
  for (let qy = 0; qy < 2; qy++) for (let qx = 0; qx < 2; qx++) {
    out.push({ label: `quarter ${qx},${qy}`, rect: { x: view.x + qx * view.w / 2, y: view.y + qy * view.h / 2, w: view.w / 2, h: view.h / 2 }, maxDim: 1400 });
  }
  for (let i = 0; i < 4; i++) {
    const cw = view.w / 8, ch = view.h / 8;
    out.push({ label: `close ${i}`, rect: { x: view.x + (i % 2) * (view.w - cw) + cw / 2, y: view.y + Math.floor(i / 2) * (view.h - ch) + ch / 2, w: cw, h: ch }, maxDim: 1400 });
  }
  return out.map(r => ({ ...r, rect: { x: Math.round(r.rect.x), y: Math.round(r.rect.y), w: Math.round(r.rect.w), h: Math.round(r.rect.h) } }));
}

async function capture(rect, maxDim) {
  const started = performance.now();
  try {
    const r = await client.call('callTool', 'capture_drawing', { shortId: board, rect, maxDim });
    return { ms: Math.round(performance.now() - started), ok: !!r?.data, bytes: r?.data ? Math.round(r.data.length * 0.75) : 0, error: r?.data ? undefined : 'no image' };
  } catch (e) {
    return { ms: Math.round(performance.now() - started), ok: false, error: (e?.message || String(e)).slice(0, 100) };
  }
}

const startedAt = new Date().toISOString();
const results = [];
for (let round = 0; round < rounds; round++) {
  for (const region of regions()) {
    const r = await capture(region.rect, region.maxDim);
    results.push({ round, label: region.label, ...r });
    console.log(`round ${round} ${region.label.padEnd(12)} ${r.ok ? `${r.ms}ms ${Math.round(r.bytes / 1024)}KB` : `FAIL ${r.ms}ms ${r.error}`}`);
    await new Promise(res => setTimeout(res, 300)); // under the bridge's burst throttle
    if (r.error?.includes('No hands workers')) { console.log('no worker; stopping'); break; }
  }
}
const ok = results.filter(r => r.ok);
const byLabel = {};
for (const r of results) (byLabel[r.label] ??= []).push(r);
const summary = {
  startedAt, board, view, rounds, captures: results.length, failures: results.length - ok.length,
  firstRoundMs: Object.fromEntries(Object.entries(byLabel).map(([l, rs]) => [l, rs[0].ms])),
  warmMedianMs: Object.fromEntries(Object.entries(byLabel).map(([l, rs]) => { const warm = rs.slice(1).filter(r => r.ok).map(r => r.ms).sort((a, b) => a - b); return [l, warm.length ? warm[Math.floor(warm.length / 2)] : null]; })),
  maxMs: Math.max(...results.map(r => r.ms)),
  errors: [...new Set(results.filter(r => !r.ok).map(r => r.error))],
};
console.log(JSON.stringify(summary));
if (logFile) appendFileSync(logFile, JSON.stringify(summary) + '\n');
process.exit(summary.failures ? 1 : 0);
