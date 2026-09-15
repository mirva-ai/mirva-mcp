/**
 * Geometry predicates for reading a board's layout.
 *
 * Board rects are top-left origin with positive width and height, so both
 * tests are plain interval comparisons on each axis. They are kept apart
 * from the audit that uses them because an audit needs a live connection
 * and these need nothing.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A board element as list_board_elements reports it. */
export interface BoardElement extends Rect {
  id: number;
  type: string;
  name?: string;
  text?: string;
  /** The entity a canvas or document layer shows; sections and notes carry none. */
  drawingId?: string;
}

/**
 * Whether two rects share any area.
 *
 * Touching edges do not count: cards laid out in a row commonly abut, and
 * treating that as a collision would report every tidy row as broken.
 */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Whether `inner` lies entirely within `outer`.
 *
 * A card exactly filling its section counts as inside — a section drawn
 * tight around its contents is deliberate, not an error.
 */
export function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h;
}

/**
 * Layers grouped by the entity each one shows, keyed by entity id.
 *
 * Sections and notes carry no reference and are left out. Both reference
 * faults are read from this: more than one layer under an id means a stale
 * layer survived a move, and an id no layer resolves means the entity was
 * binned while still on the board.
 */
export function groupByDrawing(elements: BoardElement[]): Map<string, BoardElement[]> {
  const byDrawing = new Map<string, BoardElement[]>();
  for (const e of elements) {
    if (!e.drawingId) continue;
    const group = byDrawing.get(e.drawingId);
    if (group) group.push(e);
    else byDrawing.set(e.drawingId, [e]);
  }
  return byDrawing;
}

/**
 * Whether a failure is the product being unreachable rather than an answer
 * about the board. These arrive identically to a per-entity refusal, so
 * without the distinction an outage is indistinguishable from a board full
 * of deleted cards.
 */
export function isInfrastructureFailure(e: unknown): boolean {
  const name = e instanceof Error ? e.name : '';
  const message = e instanceof Error ? e.message : String(e);
  return /HandsUnavailable|No hands workers|timed out|deadline|ECONNREFUSED|socket hang up/i.test(`${name} ${message}`);
}
