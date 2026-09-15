/**
 * Timed matrix of bridge captures through one persistent client, so each
 * number is the bridge's own cost and not a process start or the reader's
 * five-second linger. Every case runs `repeat` times; the first is cold.
 *
 *   MIRVA_URL=... MIRVA_API_KEY=... node tools/bench.ts <boardId> <canvasId> [repeat]
 */
import { credentialsFromEnv, errorMessage, isImageResult, isTextResult, MirvaClient } from '../src/transport.ts';

interface Run {
  ms: number;
  ok: boolean;
  size?: string;
  error?: string;
}

const [board, canvas, repeatArg] = process.argv.slice(2);
const repeat = Number(repeatArg || 3);
const client = new MirvaClient({ url: process.env.MIRVA_URL || 'http://localhost:4000', ...credentialsFromEnv() });

async function timed(name: string, args: Record<string, unknown>): Promise<Run> {
  const started = performance.now();
  try {
    const r = await client.call('callTool', name, args);
    const size = isImageResult(r)
      ? Math.round(r.data.length * 0.75 / 1024) + ' KB'
      : (isTextResult(r) ? r.text.length : 0) + ' chars';
    return { ms: Math.round(performance.now() - started), ok: true, size };
  } catch (e) {
    return { ms: Math.round(performance.now() - started), ok: false, error: errorMessage(e).slice(0, 80) };
  }
}

const cases: [string, string, Record<string, unknown>][] = [
  ['canvas open', 'open_drawing', { shortId: canvas }],
  ['canvas full', 'capture_drawing', { shortId: canvas, maxDim: 1024 }],
  ['canvas rect 300', 'capture_drawing', { shortId: canvas, rect: { x: 0, y: 0, w: 300, h: 200 }, maxDim: 1024 }],
  ['canvas layer solo', 'capture_drawing', { shortId: canvas, layerId: 1, maxDim: 1024 }],
  ['board open', 'open_drawing', { shortId: board }],
  ['board elements', 'list_board_elements', { boardId: board }],
  ['board far 600', 'capture_drawing', { shortId: board, rect: { x: -871, y: -3743, w: 82544, h: 41367 }, maxDim: 600 }],
  ['board far 1400', 'capture_drawing', { shortId: board, rect: { x: -871, y: -3743, w: 82544, h: 41367 }, maxDim: 1400 }],
  ['board mid 1400', 'capture_drawing', { shortId: board, rect: { x: 35725, y: 12750, w: 3316, h: 1662 }, maxDim: 1400 }],
  ['board close 1400', 'capture_drawing', { shortId: board, rect: { x: 36000, y: 13000, w: 800, h: 400 }, maxDim: 1400 }],
  ['board empty 1400', 'capture_drawing', { shortId: board, rect: { x: 200000, y: 200000, w: 2000, h: 1000 }, maxDim: 1400 }],
];

for (const [label, tool, args] of cases) {
  const runs: Run[] = [];
  for (let i = 0; i < repeat; i++) {
    const run = await timed(tool, args);
    runs.push(run);
    // The bridge throttles bursts; a failed call returns at once, so the pace is kept by hand.
    await new Promise(r => setTimeout(r, 400));
    if (run.error?.includes('No hands workers')) { console.log('no worker; stopping'); process.exit(2); }
  }
  console.log(label.padEnd(20), runs.map(r => (r.ok ? `${r.ms}ms` : `FAIL(${r.ms}ms ${r.error})`).padEnd(14)).join(' '), runs[0].size || '');
}
process.exit(0);
