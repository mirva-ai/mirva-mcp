/**
 * Board consistency audit.
 *
 * Four faults have each cost real time to find by hand:
 *
 *   - a canvas referenced by more than one layer — a move that left its old
 *     layer behind, which reads as a card apparently in two places
 *   - an entity that no longer resolves though a layer still shows it
 *   - overlapping cards, which read as a mistake whatever caused them
 *   - a card sitting inside no section at all, which on a laid-out board
 *     usually means it was placed and forgotten
 *
 * The first, third and fourth are a single pass over the board's own
 * element list. The second cannot be: a soft-deleted entity is absent from
 * no listing and identical in a capture, so each referenced id has to be
 * asked for individually.
 *
 * The listing is taken without a region on purpose: a region answers only
 * what is inside it, and every fault here is about something being
 * somewhere the caller did not think to look.
 *
 * Usage:
 *   MIRVA_URL=... MIRVA_TOKEN=... node tools/audit-board.mjs <boardId>
 */
import { credentialsFromEnv, MirvaClient } from '../src/transport.mjs';
import { contains, groupByDrawing, isInfrastructureFailure, overlaps } from './board-geometry.mjs';

const boardId = process.argv[2];
if (!boardId) {
  console.error('usage: node tools/audit-board.mjs <boardId>');
  process.exit(2);
}

const client = new MirvaClient({
  url: process.env.MIRVA_URL || 'http://localhost:4000',
  ...credentialsFromEnv(),
});

const timer = setTimeout(() => { console.error('TIMEOUT'); process.exit(2); }, 90000);
try {
  const raw = await client.call('callTool', 'list_board_elements', { boardId });
  const elements = JSON.parse(raw.text).elementBounds;

  const sections = elements.filter(e => e.type === 'section');
  const cards = elements.filter(e => e.type === 'canvas');
  const problems = [];

  const byDrawing = groupByDrawing(elements);
  for (const [drawingId, layers] of byDrawing) {
    if (layers.length > 1) {
      const at = layers.map(l => `#${l.id}@(${l.x},${l.y})`).join(' ');
      problems.push(`${drawingId} referenced by ${layers.length} layers: ${at}`);
    }
  }

  // A layer can outlive the thing it shows. A move replaces the layer and
  // the server then decides whether anything still references the entity;
  // when that count is taken before the new layer is visible, the entity is
  // soft-deleted while its layer goes on rendering. The card looks right
  // and every later edit of it fails, so the board cannot be trusted from a
  // capture alone. get_drawing refuses a removed entity, which is the only
  // signal for this available through the tools.
  for (const [drawingId, layers] of byDrawing) {
    try {
      await client.call('callTool', 'get_drawing', { shortId: drawingId });
    } catch (e) {
      // Only a refusal about this entity says anything about the board. A
      // worker outage refuses every call alike, and reading that as "every
      // card was deleted" turns an infrastructure failure into a page of
      // false findings about the board.
      if (isInfrastructureFailure(e)) throw e;
      const at = layers.map(l => `#${l.id} "${l.name}"`).join(' ');
      problems.push(`${drawingId} is referenced by ${layers.length} layer(s) but no longer resolves: ${at}`);
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
} catch (e) {
  // Exit 2 is "the audit could not run", distinct from exit 1's "the board
  // has a problem". Both once exited non-zero the same way, so a worker
  // that went away read as a failing board.
  console.error(`audit could not complete: ${e?.message ?? e}`);
  process.exit(2);
} finally {
  clearTimeout(timer);
  client.close();
}
