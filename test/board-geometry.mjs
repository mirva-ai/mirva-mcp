/**
 * The audit's geometry, tested.
 *
 * The audit is what catches mistakes I have repeatedly failed to see by
 * eye, so a fault in these two predicates would be worse than having no
 * audit: it would report "no problems found" over a board that has them.
 *
 * Run: node test/board-geometry.mjs
 */
import { contains, overlaps } from '../tools/board-geometry.mjs';

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

console.log();
if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log('all board geometry checks pass');
