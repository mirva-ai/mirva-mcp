#!/usr/bin/env node
/**
 * MCP board viewer: a page whose every pixel and every action comes through
 * the same MCP bridge and API key an agent uses. The board is never rendered
 * locally — it is the PNG capture_drawing returns for the visible region —
 * and every interaction is a tool call, so anything the page cannot offer is
 * a gap the agent has too. Two logs record that: the verbs used, and the
 * intents that had no verb.
 *
 *   MIRVA_API_KEY=... mirva-mcp-viewer          (or: node viewer/server.mjs)
 *   MIRVA_URL selects the server, as for mirva-mcp; VIEWER_PORT the local port.
 */
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { credentialsFromEnv, MirvaClient } from '../src/transport.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.VIEWER_PORT || 5177);
const client = new MirvaClient({ url: process.env.MIRVA_URL || 'https://mirva.ai', ...credentialsFromEnv() });

/** Every tool call the page made, newest last: what the agent would have done. */
const verbs = [];
/** Every intent the page could not satisfy with a tool: what the agent cannot do. */
const gaps = [];

/** A tool's payload with the transport's envelopes taken off; an image comes back as bytes. */
async function tool(name, args) {
  const started = Date.now();
  try {
    const result = await client.call('callTool', name, args);
    verbs.push({ name, args, ms: Date.now() - started, ok: true, at: new Date().toISOString() });
    if (result?.data && /^image\//.test(result.mimeType || '')) return { image: Buffer.from(result.data, 'base64'), mimeType: result.mimeType };
    if (typeof result?.text === 'string') { try { return JSON.parse(result.text); } catch { return result.text; } }
    return result;
  } catch (e) {
    verbs.push({ name, args, ms: Date.now() - started, ok: false, error: e?.message || String(e), at: new Date().toISOString() });
    throw e;
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

const num = (q, key) => (q.get(key) === null ? undefined : Number(q.get(key)));

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const q = url.searchParams;
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSync(join(here, 'index.html')));
    } else if (url.pathname === '/favicon.ico') {
      res.writeHead(204); res.end();
    } else if (url.pathname === '/api/tools') {
      const listed = await client.call('listTools');
      json(res, 200, listed.tools ?? listed);
    } else if (url.pathname === '/api/drawings') {
      json(res, 200, await tool('list_drawings', { limit: num(q, 'limit') ?? 50 }));
    } else if (url.pathname === '/api/open') {
      json(res, 200, await tool('open_drawing', { shortId: q.get('shortId') }));
    } else if (url.pathname === '/api/elements') {
      const region = q.has('x') ? { x: num(q, 'x'), y: num(q, 'y'), w: num(q, 'w'), h: num(q, 'h') } : {};
      json(res, 200, await tool('list_board_elements', { boardId: q.get('boardId'), ...region }));
    } else if (url.pathname === '/api/comments') {
      json(res, 200, await tool('list_comments', { drawingId: q.get('drawingId') }));
    } else if (url.pathname === '/api/capture') {
      const rect = q.has('x') ? { rect: { x: num(q, 'x'), y: num(q, 'y'), w: num(q, 'w'), h: num(q, 'h') } } : {};
      const captured = await tool('capture_drawing', { shortId: q.get('shortId'), maxDim: num(q, 'maxDim') ?? 1024, layerId: num(q, 'layerId'), ...rect });
      if (!captured?.image) return json(res, 502, { error: 'capture returned no image', result: captured });
      res.writeHead(200, { 'Content-Type': captured.mimeType, 'Cache-Control': 'no-store' });
      res.end(captured.image);
    } else if (url.pathname === '/api/call' && req.method === 'POST') {
      // Any verb the bridge offers, with the page's arguments, logged like the rest.
      const { name, args } = await readBody(req);
      if (typeof name !== 'string') return json(res, 400, { error: 'name is required' });
      json(res, 200, { result: await tool(name, args ?? {}) });
    } else if (url.pathname === '/api/log') {
      json(res, 200, { verbs, gaps });
    } else if (url.pathname === '/api/gap' && req.method === 'POST') {
      const gap = await readBody(req);
      gaps.push({ ...gap, at: new Date().toISOString() });
      json(res, 200, { recorded: gaps.length });
    } else {
      json(res, 404, { error: 'not found' });
    }
  } catch (e) {
    json(res, 500, { error: e?.message || String(e) });
  }
}).listen(port, () => console.log(`MCP board viewer on http://localhost:${port} (bridge ${process.env.MIRVA_URL || 'https://mirva.ai'})`));
