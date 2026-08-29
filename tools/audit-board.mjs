/**
 * Board consistency audit.
 *
 * Three faults have each cost real time to find by hand, and each is a
 * single pass over the board's own element list:
 *
 *   - a canvas referenced by more than one layer — a move that left its old
 *     layer behind, which reads as a card apparently in two places
 *   - overlapping cards, which read as a mistake whatever caused them
 *   - a card sitting inside no section at all, which on a laid-out board
 *     usually means it was placed and forgotten
 *
 * The listing is taken without a region on purpose: a region answers only
 * what is inside it, and every fault here is about something being
 * somewhere the caller did not think to look.
 *
 * Usage:
 *   MIRVA_URL=... MIRVA_TOKEN=... node tools/audit-board.mjs <boardId>
 */
import { MirvaClient } from '../src/transport.mjs';

const boardId = process.argv[2];
if (!boardId) {
  console.error('usage: node tools/audit-board.mjs <boardId>');
  process.exit(2);
}

const client = new MirvaClient({
  url: process.env.MIRVA_URL || 'http://localhost:4000',
  token: process.env.MIRVA_TOKEN || '',
});

/** Two rects touch when they overlap on both axes. */
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** A rect sits inside another when every edge is within it. */
function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h;
}

const timer = setTimeout(() => { console.error('TIMEOUT'); process.exit(2); }, 90000);
try {
  const raw = await client.call('callTool', 'list_board_elements', { boardId });
  const elements = JSON.parse(raw.text).elementBounds;

  const sections = elements.filter(e => e.type === 'section');
  const cards = elements.filter(e => e.type === 'canvas');
  const problems = [];

  const byDrawing = new Map();
  for (const e of elements) {
    if (!e.drawingId) continue;
    if (!byDrawing.has(e.drawingId)) byDrawing.set(e.drawingId, []);
    byDrawing.get(e.drawingId).push(e);
  }
  for (const [drawingId, layers] of byDrawing) {
    if (layers.length > 1) {
      const at = layers.map(l => `#${l.id}@(${l.x},${l.y})`).join(' ');
      problems.push(`${drawingId} referenced by ${layers.length} layers: ${at}`);
    }
  }

  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (overlaps(cards[i], cards[j])) {
        problems.push(`overlap: #${cards[i].id} "${cards[i].name}" and #${cards[j].id} "${cards[j].name}"`);
      }
    }
  }

  const loose = cards.filter(c => !sections.some(s => contains(s, c)));
  console.log(`${elements.length} elements: ${cards.length} cards, ${sections.length} sections`);
  console.log(`${loose.length} card(s) outside every section`);
  if (!problems.length) {
    console.log('no problems found');
    process.exit(0);
  }
  for (const p of problems) console.log(`  ${p}`);
  console.log(`${problems.length} problem(s)`);
  process.exit(1);
} finally {
  clearTimeout(timer);
  client.close();
}
