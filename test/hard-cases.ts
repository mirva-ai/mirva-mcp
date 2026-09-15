#!/usr/bin/env node
/**
 * Adversarial exercise of the MCP surface against a live server.
 *
 * Every case asserts on OBSERVED behaviour, so a pass means the server was
 * actually driven — not that a mock agreed with itself. Cases are written
 * to be safe to re-run: nothing here deletes, and created sessions are
 * inert.
 *
 *   MIRVA_URL=http://localhost:8080 MIRVA_TOKEN=... node test/hard-cases.ts
 *
 * Optional second accounts: MIRVA_OUTSIDER_TOKEN (no membership anywhere) and
 * MIRVA_VIEWER_TOKEN (a member of MIRVA_BOARD's team whose role carries view
 * and comment permissions but not CanDrawOnEntities).
 */

import { readFileSync, statSync } from 'fs';
import { credentialsFromEnv, errorMessage, isTextResult, MirvaClient } from '../src/transport.ts';

const url = process.env.MIRVA_URL || 'http://localhost:8080';
const credentials = credentialsFromEnv();
/** Board the composition cases read from. They only read and refuse — nothing
 *  in this suite writes to it — so any board the account can see will do. */
const BOARD = process.env.MIRVA_BOARD || '';
if (!credentials.apiKey && !credentials.token) {
  console.error('MIRVA_API_KEY or MIRVA_TOKEN is required');
  process.exit(1);
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

/**
 * Server-side error watch.
 *
 * A tool that answers "FAILED: ..." cleanly can still be sitting on an
 * exception the server logged — a missing stub, a swallowed rejection. The
 * call looks handled while the product is broken underneath, so the run
 * also fails if the server logged an error while it was happening.
 */
const SERVER_LOG = process.env.MIRVA_WARN_LOG
  || '/Users/rush/code/nexus-gitea/portal/data/logs/warn.' +
     new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.log';

function logSize(): number {
  try {
    return statSync(SERVER_LOG).size;
  } catch {
    return -1;
  }
}

function logSince(offset: number): string {
  if (offset < 0) return '';
  try {
    const buf = readFileSync(SERVER_LOG);
    return buf.subarray(offset).toString('utf8');
  } catch {
    return '';
  }
}

/** Lines worth failing a run over, as opposed to routine warnings. */
function serverErrors(text: string): string[] {
  return text.split('\n').filter(l =>
    /TypeError|ReferenceError|is not a function|Unhandled|UnhandledPromiseRejection|Cannot read/.test(l));
}

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  const before = logSize();
  try {
    await fn();
    const errs = serverErrors(logSince(before));
    if (errs.length) throw new Error(`server logged an error: ${errs[0].slice(0, 160)}`);
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${errorMessage(e)}`);
    console.log(`  FAIL ${name} — ${errorMessage(e)}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Outcome = { ok: true; result: unknown } | { ok: false; error: string };

/** Call a tool, returning either its result or the error it raised. */
async function callTool(client: MirvaClient, name: string, args: Record<string, unknown>): Promise<Outcome> {
  try {
    const result = await client.call('callTool', name, args);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** The JSON a text result carries. */
function parsed(result: unknown): any {
  return JSON.parse(isTextResult(result) ? result.text : '{}');
}

interface ElementRow {
  type: string;
  drawingId?: string;
}

async function main(): Promise<void> {
  const client = new MirvaClient({ url, ...credentials });

  console.log('\n== surface ==');
  const tools = await client.call('listTools');
  const names = tools.map(t => t.name);
  await check('listTools returns a non-empty set', () => {
    assert(tools.length > 0, 'no tools returned');
  });
  await check('every tool has a name, description and object schema', () => {
    for (const t of tools) {
      assert(t.name, 'tool without a name');
      assert(t.description, `${t.name}: no description`);
      assert(t.inputSchema?.type === 'object', `${t.name}: schema is not an object`);
    }
  });
  await check('every required arg is declared in properties', () => {
    for (const t of tools) {
      for (const key of t.inputSchema.required ?? []) {
        assert(t.inputSchema.properties?.[key], `${t.name}: required "${key}" is not a declared property`);
      }
    }
  });

  console.log('\n== unknown and malformed calls ==');
  await check('an unknown tool is refused', async () => {
    const r = await callTool(client, 'no_such_tool', {});
    assert(!r.ok, 'unknown tool did not fail');
  });
  await check('a missing required arg is refused', async () => {
    const r = await callTool(client, 'get_drawing', {});
    assert(!r.ok, 'missing shortId was accepted');
  });
  await check('a wrong-typed arg is refused, not coerced into a lookup', async () => {
    const r = await callTool(client, 'get_drawing', { shortId: 12345 });
    assert(!r.ok, 'numeric shortId was accepted');
  });
  await check('an empty-string id is refused', async () => {
    const r = await callTool(client, 'get_drawing', { shortId: '' });
    assert(!r.ok, 'empty shortId was accepted');
  });
  await check('extra unknown args are ignored, not fatal', async () => {
    const r = await callTool(client, 'list_drawings', { limit: 1, nonsense: 'x', deep: { a: 1 } });
    assert(r.ok, `extra args broke the call: ${r.ok ? '' : r.error}`);
  });

  console.log('\n== identifiers ==');
  await check('a well-formed but absent id reports not-found', async () => {
    const r = await callTool(client, 'get_drawing', { shortId: 'zzzzzzzzzz' });
    assert(!r.ok, 'absent id succeeded');
    assert(/not found/i.test(r.error), `expected not-found, got: ${r.error}`);
  });
  await check('an id the account cannot see is INDISTINGUISHABLE from absent', async () => {
    // A syntactically valid id that exists for nobody here; the answer must
    // match the absent case exactly, or the tool becomes an existence oracle.
    const absent = await callTool(client, 'get_drawing', { shortId: 'zzzzzzzzzz' });
    const foreign = await callTool(client, 'get_drawing', { shortId: 'aaaaaaaaaa' });
    assert(!absent.ok && !foreign.ok, 'one of the two lookups succeeded');
    assert(absent.error === foreign.error, `answers differ: "${absent.error}" vs "${foreign.error}"`);
  });
  await check('an oversized id is refused without a crash', async () => {
    const r = await callTool(client, 'get_drawing', { shortId: 'x'.repeat(10_000) });
    assert(!r.ok, 'a 10k id was accepted');
  });
  await check('unicode in an id is handled', async () => {
    const r = await callTool(client, 'get_drawing', { shortId: '🎨绘画' });
    assert(!r.ok, 'unicode id was accepted');
  });

  console.log('\n== bounds ==');
  await check('limit is clamped rather than trusted', async () => {
    const r = await callTool(client, 'list_drawings', { limit: 100_000 });
    assert(r.ok, `large limit failed: ${r.ok ? '' : r.error}`);
    const rows = parsed(r.result);
    assert(Array.isArray(rows), 'result is not an array');
    assert(rows.length <= 100, `limit not clamped: ${rows.length} rows`);
  });
  await check('a negative limit does not throw', async () => {
    const r = await callTool(client, 'list_drawings', { limit: -5 });
    assert(r.ok, `negative limit failed: ${r.ok ? '' : r.error}`);
  });
  await check('a non-numeric limit is refused', async () => {
    const r = await callTool(client, 'list_drawings', { limit: 'lots' });
    assert(!r.ok, 'non-numeric limit was accepted');
  });

  if (!BOARD) {
    console.log('\n== board composition == (skipped: set MIRVA_BOARD)');
  } else {
    console.log('\n== board composition ==');
    // These tools write to a board, so every case here either refuses or
    // cleans up after itself. A test that leaves debris on a shared board is
    // worse than no test.
    await check('list_board_elements refuses an unknown board', async () => {
      const r = await callTool(client, 'list_board_elements', { boardId: 'zzzzzzzzzz' });
      assert(!r.ok, 'an unknown board was listed');
    });
    await check('a region needs all four of x, y, w, h', async () => {
      const r = await callTool(client, 'list_board_elements', { boardId: BOARD, x: 0, y: 0 });
      assert(!r.ok, 'a half-specified region was accepted');
    });
    await check('an omitted region means the whole board', async () => {
      const r = await callTool(client, 'list_board_elements', { boardId: BOARD });
      assert(r.ok, `whole-board listing failed: ${r.ok ? '' : r.error}`);
      const body = parsed(r.result);
      assert(Array.isArray(body.elementBounds), 'no elementBounds array');
      assert(body.count === body.elementBounds.length, 'count disagrees with the array');
    });
    await check('a section needs a positive width and height', async () => {
      const r = await callTool(client, 'create_section',
        { boardId: BOARD, name: 'zero', x: 0, y: 0, w: 0, h: 100 });
      assert(!r.ok, 'a zero-width section was created');
    });
    await check('place_card refuses a drawing that does not exist', async () => {
      const r = await callTool(client, 'place_card',
        { boardId: BOARD, drawingId: 'zzzzzzzzzz', x: 0, y: 0, w: 100 });
      assert(!r.ok, 'a nonexistent drawing was placed');
    });
    await check('place_card refuses a non-positive width', async () => {
      const r = await callTool(client, 'place_card',
        { boardId: BOARD, drawingId: BOARD, x: 0, y: 0, w: 0 });
      assert(!r.ok, 'a zero-width placement was accepted');
    });
    await check('move_board_object refuses an unknown layer', async () => {
      const r = await callTool(client, 'move_board_object',
        { boardId: BOARD, layerId: 999999, x: 0, y: 0 });
      assert(!r.ok, 'an unknown layer was moved');
    });
    await check('add_note requires text', async () => {
      const r = await callTool(client, 'add_note', { boardId: BOARD, x: 0, y: 0 });
      assert(!r.ok, 'a note with no text was pinned');
    });
    await check('undo_agent_edits refuses an unknown message', async () => {
      const r = await callTool(client, 'undo_agent_edits', { messageId: '000000000000000000000000' });
      assert(!r.ok, 'an unknown message was undone');
    });
    await check('read_message_image refuses an unknown file', async () => {
      const r = await callTool(client, 'read_message_image', { fileId: '000000000000000000000000' });
      assert(!r.ok, 'an unknown fileId returned an image');
    });
  }

  console.log('\n== chat ==');
  if (names.includes('create_ai_session')) {
    let channelName: string | undefined;
    await check('an AI session can be created', async () => {
      const r = await callTool(client, 'create_ai_session', {});
      assert(r.ok, `create failed: ${r.ok ? '' : r.error}`);
      channelName = parsed(r.result).channelName;
      assert(typeof channelName === 'string' && /^ai-session\//.test(channelName), `unexpected channel: ${channelName}`);
    });
    await check('a message to a nonexistent channel is refused', async () => {
      const r = await callTool(client, 'send_message', {
        channelName: 'ai-session/000000000000000000000000',
        message: 'hello',
      });
      assert(!r.ok, 'send to a nonexistent channel succeeded');
    });
    await check('an empty message is refused', async () => {
      const r = await callTool(client, 'send_message', { channelName, message: '' });
      assert(!r.ok, 'empty message was accepted');
    });
    await check('a malformed channel name is refused', async () => {
      const r = await callTool(client, 'send_message', { channelName: 'not-a-channel', message: 'hi' });
      assert(!r.ok, 'malformed channel was accepted');
    });
    await check('reading a nonexistent channel does not leak', async () => {
      const r = await callTool(client, 'get_messages', {
        channelName: 'ai-session/000000000000000000000000',
      });
      // Either refuse or answer empty; what must not happen is another
      // session's contents.
      if (r.ok) assert(parsed(r.result).length === 0, 'messages returned for a foreign channel');
    });
  }

  // A second account with no membership anywhere. Cross-account refusal is
  // the property that matters most, and asserting it against ids that exist
  // for nobody proves nothing — these are the FIRST account's real drawings.
  const outsiderToken = process.env.MIRVA_OUTSIDER_TOKEN;
  if (outsiderToken) {
    console.log('\n== cross-account ==');
    const mine = await callTool(client, 'list_drawings', { limit: 3 });
    const myIds: string[] = mine.ok ? parsed(mine.result).map((e: { shortId: string }) => e.shortId) : [];
    const outsider = new MirvaClient({ url, token: outsiderToken });

    await check('another account cannot read my drawings', async () => {
      assert(myIds.length > 0, 'no drawings to probe with');
      for (const id of myIds) {
        const r = await callTool(outsider, 'get_drawing', { shortId: id });
        assert(!r.ok, `outsider read ${id}`);
      }
    });
    await check('refusal is INDISTINGUISHABLE from not-found', async () => {
      const denied = await callTool(outsider, 'get_drawing', { shortId: myIds[0] });
      const absent = await callTool(outsider, 'get_drawing', { shortId: 'zzzzzzzzzz' });
      assert(!denied.ok && !absent.ok, 'a probe succeeded');
      assert(denied.error === absent.error, `differs: "${denied.error}" vs "${absent.error}"`);
    });
    await check('my drawings do not appear in another account listing', async () => {
      const r = await callTool(outsider, 'list_drawings', { limit: 100 });
      assert(r.ok, `listing failed: ${r.ok ? '' : r.error}`);
      const theirs: string[] = parsed(r.result).map((e: { shortId: string }) => e.shortId);
      const leaked = myIds.filter(id => theirs.includes(id));
      assert(leaked.length === 0, `leaked: ${leaked.join(', ')}`);
    });
    await check('another account cannot read my chat channel', async () => {
      assert(names.includes('create_ai_session'), 'chat tools absent — case did not run');
      const session = await callTool(client, 'create_ai_session', {});
      assert(session.ok, 'could not create a session to probe');
      const channelName = parsed(session.result).channelName;
      const r = await callTool(outsider, 'get_messages', { channelName });
      if (r.ok) assert(parsed(r.result).length === 0, 'outsider read my session messages');
    });
    await check('another account cannot post to my chat channel', async () => {
      assert(names.includes('create_ai_session'), 'chat tools absent — case did not run');
      const session = await callTool(client, 'create_ai_session', {});
      assert(session.ok, 'could not create a session to probe');
      const channelName = parsed(session.result).channelName;
      const r = await callTool(outsider, 'send_message', { channelName, message: 'intrusion' });
      assert(!r.ok, 'outsider posted into my session');
    });

    outsider.close();
  }

  // A second account that CAN see the first account's board but holds a role
  // without CanDrawOnEntities. Reads must answer; every mutation must refuse,
  // and say why — this caller already knows the drawing exists. The document
  // write is the case that matters most: it never reaches the drawing socket,
  // so this gate is the only one it has.
  const viewerToken = process.env.MIRVA_VIEWER_TOKEN;
  if (viewerToken && BOARD) {
    console.log('\n== view-only collaborator ==');
    const viewer = new MirvaClient({ url, token: viewerToken });
    const EDIT_REFUSAL = 'You can view this drawing but not edit it';

    await check('a viewer can read the board', async () => {
      const r = await callTool(viewer, 'get_drawing', { shortId: BOARD });
      assert(r.ok, `viewer could not read the board: ${r.ok ? '' : r.error}`);
    });
    const elements = await callTool(viewer, 'list_board_elements', { boardId: BOARD });
    const rows: ElementRow[] = elements.ok ? parsed(elements.result).elementBounds : [];
    const docs = rows.filter(e => e.type === 'document');
    const canvases = rows.filter(e => e.type === 'canvas');
    await check('a viewer can read a document on it', async () => {
      assert(docs.length > 0, 'no document on the board to read');
      const r = await callTool(viewer, 'read_document', { documentId: docs[0].drawingId });
      assert(r.ok, `viewer could not read the document: ${r.ok ? '' : r.error}`);
    });
    await check('a viewer cannot overwrite a document', async () => {
      assert(docs.length > 0, 'no document on the board to probe');
      const r = await callTool(viewer, 'write_document', { boardId: BOARD, documentId: docs[0].drawingId, content: '# intrusion' });
      assert(!r.ok, 'viewer overwrote a document');
      assert(r.error.includes(EDIT_REFUSAL), `refusal did not name the missing permission: "${r.error}"`);
    });
    const intrusions: [string, Record<string, unknown>][] = [
      ['create_section', { boardId: BOARD, name: 'intrusion', x: 0, y: 0, w: 100, h: 100 }],
      ['add_note', { boardId: BOARD, text: 'intrusion', x: 0, y: 0 }],
      ['remove_layers', { drawingId: BOARD, layerIds: [1] }],
      ['create_canvas', { boardId: BOARD, name: 'intrusion', width: 64, height: 64 }],
    ];
    for (const [tool, args] of intrusions) {
      await check(`a viewer cannot ${tool}`, async () => {
        const r = await callTool(viewer, tool, args);
        assert(!r.ok, `viewer ran ${tool}`);
        assert(r.error.includes(EDIT_REFUSAL), `${tool}: "${r.error}"`);
      });
    }
    await check('a viewer cannot draw on a canvas of the board', async () => {
      assert(canvases.length > 0, 'no canvas on the board to probe');
      const r = await callTool(viewer, 'draw_shapes', { drawingId: canvases[0].drawingId, layerId: 1, shapes: [{ kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }] });
      assert(!r.ok, 'viewer drew on a canvas');
      assert(r.error.includes(EDIT_REFUSAL), `draw_shapes: "${r.error}"`);
    });
    viewer.close();
  }

  if (names.includes('capture_drawing')) {
    console.log('\n== drawing session ==');
    const mine = await callTool(client, 'list_drawings', { limit: 5 });
    const canvas: { shortId: string } | undefined = mine.ok
      ? parsed(mine.result).find((e: { type: string }) => e.type === 'Drawing')
      : undefined;

    await check('open_drawing reports a live session', async () => {
      assert(canvas, 'no canvas to open');
      const r = await callTool(client, 'open_drawing', { shortId: canvas.shortId });
      assert(r.ok, `open failed: ${r.ok ? '' : r.error}`);
      const info = parsed(r.result);
      assert(info.width > 0 && info.height > 0, 'no dimensions reported');
      assert(Array.isArray(info.layers), 'no layers reported');
    });

    await check('capture_drawing returns real image bytes', async () => {
      assert(canvas, 'no canvas to capture');
      const r = await callTool(client, 'capture_drawing', { shortId: canvas.shortId });
      assert(r.ok, `capture failed: ${r.ok ? '' : r.error}`);
      // The result must be an image, not a text explanation of one: reading
      // the wrong field returned "no image" while the session was fine.
      const image = r.result as { type?: string; data?: string };
      assert(image.type === 'image', `expected an image, got ${image.type}`);
      assert((image.data?.length ?? 0) > 1000, `suspiciously small image: ${image.data?.length} bytes`);
    });

    await check('capturing a nonexistent layer explains itself', async () => {
      assert(canvas, 'no canvas');
      const r = await callTool(client, 'capture_drawing', { shortId: canvas.shortId, layerId: 999999 });
      assert(!r.ok, 'a nonexistent layer captured successfully');
      assert(/layer/i.test(r.error), `unhelpful reason: ${r.error}`);
    });
  }

  console.log('\n== concurrency and recovery ==');
  await check('concurrent calls all resolve', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => callTool(client, 'list_drawings', { limit: 2 })),
    );
    const bad = results.filter(r => !r.ok);
    assert(bad.length === 0, `${bad.length}/8 failed, first: ${bad[0] && !bad[0].ok ? bad[0].error : ''}`);
  });
  await check('a call after the socket drops still succeeds', async () => {
    // Deepkit's client re-establishes the socket itself; this pins that,
    // since the tool layer relies on it instead of retrying.
    await client.ensureConnected();
    assert(client.rpc, 'no rpc client to disconnect');
    client.rpc.disconnect();
    const r = await callTool(client, 'list_drawings', { limit: 1 });
    assert(r.ok, `no recovery after the socket dropped: ${r.ok ? '' : r.error}`);
  });
  await check('a call after the client handle is cleared still succeeds', async () => {
    client.reset();
    const r = await callTool(client, 'list_drawings', { limit: 1 });
    assert(r.ok, `no recovery after reset: ${r.ok ? '' : r.error}`);
  });

  console.log('\n== auth ==');
  await check('a garbage token cannot list tools', async () => {
    const bad = new MirvaClient({ url, token: 'not-a-real-token' });
    let refused = false;
    try {
      await bad.call('listTools');
    } catch {
      refused = true;
    } finally {
      bad.close();
    }
    assert(refused, 'a garbage token was accepted');
  });

  client.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nfailures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(`harness error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(2);
});
