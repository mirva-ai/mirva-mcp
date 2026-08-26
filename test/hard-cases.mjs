#!/usr/bin/env node
/**
 * Adversarial exercise of the MCP surface against a live server.
 *
 * Every case asserts on OBSERVED behaviour, so a pass means the server was
 * actually driven — not that a mock agreed with itself. Cases are written
 * to be safe to re-run: nothing here deletes, and created sessions are
 * inert.
 *
 *   MIRVA_URL=http://localhost:8080 MIRVA_TOKEN=... node test/hard-cases.mjs
 */

import { MirvaClient } from '../src/transport.mjs';

const url = process.env.MIRVA_URL || 'http://localhost:8080';
const token = process.env.MIRVA_TOKEN || '';
if (!token) {
  console.error('MIRVA_TOKEN is required');
  process.exit(1);
}

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e?.message ?? e}`);
    console.log(`  FAIL  ${name} — ${e?.message ?? e}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Call a tool, returning either its result or the error it raised. */
async function callTool(client, name, args) {
  try {
    const result = await client.call('callTool', name, args);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

function parsed(result) {
  return JSON.parse(result.text ?? '{}');
}

async function main() {
  const client = new MirvaClient({ url, token });

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
    assert(r.ok, `extra args broke the call: ${r.error}`);
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
    assert(r.ok, `large limit failed: ${r.error}`);
    const rows = parsed(r.result);
    assert(Array.isArray(rows), 'result is not an array');
    assert(rows.length <= 100, `limit not clamped: ${rows.length} rows`);
  });
  await check('a negative limit does not throw', async () => {
    const r = await callTool(client, 'list_drawings', { limit: -5 });
    assert(r.ok, `negative limit failed: ${r.error}`);
  });
  await check('a non-numeric limit is refused', async () => {
    const r = await callTool(client, 'list_drawings', { limit: 'lots' });
    assert(!r.ok, 'non-numeric limit was accepted');
  });

  console.log('\n== chat ==');
  if (names.includes('create_ai_session')) {
    let channelName;
    await check('an AI session can be created', async () => {
      const r = await callTool(client, 'create_ai_session', {});
      assert(r.ok, `create failed: ${r.error}`);
      channelName = parsed(r.result).channelName;
      assert(/^ai-session\//.test(channelName), `unexpected channel: ${channelName}`);
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

  console.log('\n== concurrency and recovery ==');
  await check('concurrent calls all resolve', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => callTool(client, 'list_drawings', { limit: 2 })),
    );
    const bad = results.filter(r => !r.ok);
    assert(bad.length === 0, `${bad.length}/8 failed, first: ${bad[0]?.error}`);
  });
  await check('a call after the socket drops still succeeds', async () => {
    // Deepkit's client re-establishes the socket itself; this pins that,
    // since the tool layer relies on it instead of retrying.
    await client.ensureConnected();
    assert(client.rpc, 'no rpc client to disconnect');
    client.rpc.disconnect();
    const r = await callTool(client, 'list_drawings', { limit: 1 });
    assert(r.ok, `no recovery after the socket dropped: ${r.error}`);
  });
  await check('a call after the client handle is cleared still succeeds', async () => {
    client.reset();
    const r = await callTool(client, 'list_drawings', { limit: 1 });
    assert(r.ok, `no recovery after reset: ${r.error}`);
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

main().catch(e => {
  console.error(`harness error: ${e?.stack ?? e}`);
  process.exit(2);
});
