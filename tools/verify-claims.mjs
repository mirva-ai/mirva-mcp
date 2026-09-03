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
 * A count on its own means everything the section holds. Prefix it with a
 * type — canvas, document, sticky — to pin down one kind, which is what a
 * section holding both a document and a card needs.
 *
 * Example, for the Ember & Ash deck:
 *   node tools/verify-claims.mjs BLGdQyMgY3 04=document:2 10=36 11=12
 */
import { credentialsFromEnv, MirvaClient } from '../src/transport.mjs';
import { contains } from './board-geometry.mjs';

const [boardId, ...pairs] = process.argv.slice(2);
if (!boardId || !pairs.length) {
  console.error('usage: node tools/verify-claims.mjs <boardId> <prefix>=<count> ...');
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
  // Everything a section can hold, not only cards: a spec section is its
  // documents, and counting canvases alone reports it as correct however
  // many of them have gone.
  const contents = elements.filter(e => e.type !== 'section');

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
    const held = contents.filter(c => contains(section, c));
    total += held.length;

    // "12" counts everything; "canvas:12" or "document:2" counts one kind,
    // which is how a section holding both is pinned down.
    const [kind, count] = want.includes(':') ? want.split(':') : [null, want];
    const matching = kind ? held.filter(c => c.type === kind) : held;
    const ok = matching.length === Number(count);
    if (!ok) wrong++;

    // "canvas" already ends in s; appending another gives "canvass".
    const plural = n => (n === 1 ? '' : kind.endsWith('s') ? 'es' : 's');
    const label = kind ? `${kind}${plural(matching.length)}` : 'items';
    const breakdown = [...new Set(held.map(c => c.type))].sort()
      .map(t => `${held.filter(c => c.type === t).length} ${t}`).join(', ');
    console.log(`  ${ok ? 'ok   ' : 'WRONG'} ${prefix} holds ${matching.length} ${label}, `
      + `expected ${count}${breakdown ? `  (${breakdown})` : ''}`);
  }
  console.log(`  ${total} items across the sections checked`);

  // A section nobody names is a section nobody counts. Eight of this
  // board's fourteen had never been claimed, so a card lost from any of
  // them would have gone on reporting a clean run. They are listed rather
  // than failed: not naming a section is a gap in what was asked for, not
  // a fault in the board.
  const named = pairs.map(p => p.split('=')[0]);
  const unclaimed = sections
    .map(s => (s.name || ''))
    .filter(name => !named.some(prefix => name.startsWith(prefix)))
    .sort();
  if (unclaimed.length) {
    console.log(`  ${unclaimed.length} section(s) carry no claim and were not counted:`);
    for (const name of unclaimed) console.log(`     ${name.slice(0, 60)}`);
  }

  if (wrong) {
    console.log(`${wrong} claim(s) do not match the board`);
    process.exit(1);
  }
  console.log('every claim matches the board');
} catch (e) {
  // Exit 2 is "the claims could not be checked", distinct from exit 1's
  // "the claims do not match". A worker that went away otherwise escaped
  // uncaught and exited 1, which reads as a board that has drifted.
  console.error(`claims could not be checked: ${e?.message ?? e}`);
  process.exit(2);
} finally {
  clearTimeout(timer);
  client.close();
}
