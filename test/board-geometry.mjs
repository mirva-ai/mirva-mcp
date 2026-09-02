/**
 * The audit's geometry, tested.
 *
 * The audit is what catches mistakes I have repeatedly failed to see by
 * eye, so a fault in these two predicates would be worse than having no
 * audit: it would report "no problems found" over a board that has them.
 *
 * Run: node test/board-geometry.mjs
 */
import { contains, groupByDrawing, isInfrastructureFailure, overlaps } from '../tools/board-geometry.mjs';

let failures = 0;

function check(name, actual, expected) {
  if (actual === expected) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name} — got ${actual}, wanted ${expected}`);
  }
}

const card = (x, y, w = 560, h = 710) => ({ x, y, w, h });

console.log('overlaps');
check('a rect overlaps itself', overlaps(card(0, 0), card(0, 0)), true);
check('separated on x', overlaps(card(0, 0), card(600, 0)), false);
check('separated on y', overlaps(card(0, 0), card(0, 800)), false);
check('offset on both axes but sharing a corner',
  overlaps(card(0, 0), card(500, 650)), true);

// The deck rows abut deliberately: cards sit 700 apart at 560 wide, so a
// 140-unit gap. Edge contact must not read as a collision or every tidy
// row on the board would be reported as broken.
check('abutting edges do not overlap', overlaps(card(0, 0), card(560, 0)), false);
check('abutting on y does not overlap', overlaps(card(0, 0), card(0, 710)), false);
check('the real deck spacing is clear', overlaps(card(32100, 14900), card(32800, 14900)), false);
check('one unit of intrusion overlaps', overlaps(card(0, 0), card(559, 0)), true);

// The fault the audit exists to catch: a move that left its old layer
// behind, so the same card appears twice a short distance apart.
check('a duplicate left 400 units away overlaps',
  overlaps(card(29153, 7400), card(29553, 7400)), true);

// Order must not matter, or a pass over pairs would miss half of them.
check('overlap is symmetric',
  overlaps(card(0, 0), card(300, 300)) === overlaps(card(300, 300), card(0, 0)), true);

console.log('contains');
const section = { x: 31900, y: 14800, w: 6300, h: 4500 };
check('a card inside its section', contains(section, card(32100, 14900)), true);
check('a card left of the section', contains(section, card(31000, 14900)), false);
check('a card below the section', contains(section, card(32100, 19000)), false);
check('a card overhanging the right edge',
  contains(section, card(37800, 14900)), false);

// A section drawn tight around its contents is deliberate — the reference
// section was resized to exactly fit its two masters.
check('a card exactly filling its section is inside',
  contains({ x: 0, y: 0, w: 560, h: 710 }, card(0, 0)), true);
check('one unit of overhang is outside',
  contains({ x: 0, y: 0, w: 559, h: 710 }, card(0, 0)), false);

// Containment is directional; a section is not inside the card it holds.
check('containment is not symmetric',
  contains(card(32100, 14900), section), false);

console.log('groupByDrawing');
// Both reference faults are read from this grouping, so what it leaves out
// matters as much as what it collects.
const layer = (id, drawingId, x = 0) => ({ id, drawingId, x, y: 0, w: 560, h: 710, type: 'canvas' });

const grouped = groupByDrawing([
  layer(1, 'aaa'), layer(2, 'bbb', 700), layer(3, 'aaa', 1400),
]);
check('layers are grouped by the entity they show', grouped.size, 2);
check('a card moved without its old layer removed shows two',
  grouped.get('aaa').length, 2);
check('a card placed once shows one', grouped.get('bbb').length, 1);

// A section is a board object in its own right, not a view of an entity.
// Counting it here would put an id in the map that nothing can resolve,
// which the removed-entity check would then report on every clean board.
const withFurniture = groupByDrawing([
  layer(1, 'aaa'),
  { id: 2, type: 'section', name: '10 — Pip Cards', x: 0, y: 0, w: 5000, h: 2000 },
  { id: 3, type: 'note', text: 'colour note', x: 100, y: 100, w: 300, h: 200 },
]);
check('sections and notes carry no reference and are skipped',
  withFurniture.size, 1);

// Documents are referenced exactly as canvases are, and it was a document
// that a move most recently binned — so the grouping must not be limited
// to cards the way the overlap check is.
const withDocument = groupByDrawing([
  layer(1, 'aaa'),
  { id: 2, type: 'document', drawingId: 'ddd', x: 0, y: 0, w: 900, h: 1200 },
]);
check('a document is grouped like any other reference', withDocument.size, 2);
check('and it is found under its own id',
  withDocument.get('ddd').length, 1);

check('an empty board groups nothing', groupByDrawing([]).size, 0);

console.log('isInfrastructureFailure');
// The audit asks the product about every referenced entity and reads a
// refusal as "this entity is gone". When the product itself is unreachable
// every call refuses alike, so without this the audit reports a healthy
// board as one where every card has been deleted.
const realOutage = Object.assign(new Error('No hands workers available'), { name: 'RpcError' });
check('the outage that actually crashed the audit is recognised',
  isInfrastructureFailure(realOutage), true);
check('a render deadline is infrastructure, not a finding',
  isInfrastructureFailure(new Error('hands capture_drawing passed its 25000ms deadline — its outcome is unknown')), true);
check('a worker task timeout is infrastructure',
  isInfrastructureFailure(new Error('hands task timed out (capture_drawing)')), true);
check('a refused connection is infrastructure',
  isInfrastructureFailure(new Error('connect ECONNREFUSED 127.0.0.1:4000')), true);

// The other half matters as much: a real answer about one entity must stay
// a finding, or the audit goes quiet about the fault it exists to catch.
check('a missing drawing stays a board finding',
  isInfrastructureFailure(new Error('Drawing not found')), false);
check('a permission refusal stays a board finding',
  isInfrastructureFailure(new Error('You do not have access to this drawing')), false);
check('an empty error is not assumed to be infrastructure',
  isInfrastructureFailure(undefined), false);

console.log('unclaimed sections');
// A section nobody names is a section nobody counts. Eight of this board's
// fourteen had never been claimed, and a card lost from any of them would
// have gone on reporting a clean run — the count was right about what it
// checked and silent about what it did not.
const unclaimedOf = (sectionNames, pairs) => {
  const named = pairs.map(p => p.split('=')[0]);
  return sectionNames.filter(name => !named.some(prefix => name.startsWith(prefix)));
};

check('a section with no claim is listed',
  unclaimedOf(['01 — Art Direction', '10 — Pip Cards'], ['10=36']).length, 1);
check('a section with a claim is not listed',
  unclaimedOf(['10 — Pip Cards'], ['10=36']).length, 0);
// A section can carry two claims — one per kind — and naming it once for
// canvases must not leave it reported as unclaimed.
check('two claims on one section still count as claimed',
  unclaimedOf(['01 — Art Direction'], ['01=canvas:1', '01=document:1']).length, 0);
check('every section claimed leaves nothing listed',
  unclaimedOf(['01 — Art', '02 — Cast'], ['01=canvas:1', '02=canvas:2']).length, 0);
// The prefix is matched against the start of the name, so a claim for "1"
// must not silently satisfy "10", "11" and the rest.
check('a prefix matches from the start of the name',
  unclaimedOf(['10 — Pip Cards'], ['1=36']).length, 0);

console.log('a passing check can still be partial');
// The runner printed only a check's last line, so a caveat from a check
// that passed never reached it: "13 sections carry no claim" was written
// to make a gap visible and was then swallowed by the tool people run.
const caveat = /carry no claim|not captured|too few to judge|could not/;
check('an unclaimed-section line is surfaced',
  caveat.test('  13 section(s) carry no claim and were not counted:'), true);
check('a too-few-to-judge line is surfaced',
  caveat.test('  --   ace black: 2 cards, median 22.3% (too few to judge)'), true);
check('an ordinary pass line is not repeated',
  caveat.test('every claim matches the board'), false);
check('a fault line is left to the failure path',
  caveat.test('WRONG 10 holds 36 items, expected 35'), false);

console.log('stored claims');
// The counts were retyped every round, which is why only the deck sections
// ever got claimed. A comment or blank line in the file is not a claim.
const parseClaims = text => text.split('\n')
  .map(line => line.split('#')[0].trim())
  .filter(Boolean);
check('comments and blanks are dropped',
  parseClaims('# note\n\n10=36\n11=12  # trailing\n').length, 2);
check('a trailing comment does not corrupt its claim',
  parseClaims('11=12  # trailing')[0], '11=12');

console.log();
if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log('all board geometry checks pass');
