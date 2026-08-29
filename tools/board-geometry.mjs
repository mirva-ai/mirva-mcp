/**
 * Geometry predicates for reading a board's layout.
 *
 * Board rects are top-left origin with positive width and height, so both
 * tests are plain interval comparisons on each axis. They are kept apart
 * from the audit that uses them because an audit needs a live connection
 * and these need nothing.
 */

/**
 * Whether two rects share any area.
 *
 * Touching edges do not count: cards laid out in a row commonly abut, and
 * treating that as a collision would report every tidy row as broken.
 */
export function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Whether `inner` lies entirely within `outer`.
 *
 * A card exactly filling its section counts as inside — a section drawn
 * tight around its contents is deliberate, not an error.
 */
export function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h;
}
