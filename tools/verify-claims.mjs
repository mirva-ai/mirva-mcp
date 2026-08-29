/**
 * Check that a board's stated card counts match what it holds.
 *
 * A section's name is a claim, and a claim drifts: cards get added, moved
 * between sections, or lost to a move that replaced their layer. This
 * compares each expectation against the board rather than against notes.
 *
 * Usage:
 *   MIRVA_URL=... MIRVA_TOKEN=... node tools/verify-claims.mjs <boardId> \
 *     <sectionPrefix>=<count> [<sectionPrefix>=<count> ...]
 *
 * Example, for the Ember & Ash deck:
 *   node tools/verify-claims.mjs BLGdQyMgY3 09=2 10=36 11=12 12=4
 */
import { MirvaClient } from '../src/transport.mjs';
import { contains } from './board-geometry.mjs';

const [boardId, ...pairs] = process.argv.slice(2);
if (!boardId || !pairs.length) {
  console.error('usage: node tools/verify-claims.mjs <boardId> <prefix>=<count> ...');
  process.exit(2);
}

const client = new MirvaClient({
  url: process.env.MIRVA_URL || 'http://localhost:4000',
  token: process.env.MIRVA_TOKEN || '',
});

const timer = setTimeout(() => { console.error('TIMEOUT'); process.exit(2); }, 90000);
try {
  const raw = await client.call('callTool', 'list_board_elements', { boardId });
  const elements = JSON.parse(raw.text).elementBounds;
  const sections = elements.filter(e => e.type === 'section');
  const cards = elements.filter(e => e.type === 'canvas');

  let wrong = 0;
  let total = 0;
  for (const pair of pairs) {
    const [prefix, want] = pair.split('=');
    const section = sections.find(s => (s.name || '').startsWith(prefix));
    if (!section) {
      console.log(`  MISSING section ${prefix}`);
      wrong++;
      continue;
    }
    const held = cards.filter(c => contains(section, c)).length;
    total += held;
    const ok = held === Number(want);
    if (!ok) wrong++;
    console.log(`  ${ok ? 'ok   ' : 'WRONG'} ${prefix} holds ${held}, expected ${want}`);
  }
  console.log(`  ${total} cards across the sections checked`);

  if (wrong) {
    console.log(`${wrong} claim(s) do not match the board`);
    process.exit(1);
  }
  console.log('every claim matches the board');
} finally {
  clearTimeout(timer);
  client.close();
}
