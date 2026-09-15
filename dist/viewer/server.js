#!/usr/bin/env node
/**
 * MCP board viewer: a page whose every pixel and every action comes through
 * the same MCP bridge and API key an agent uses. The board is never rendered
 * locally — it is the PNG capture_drawing returns for the visible region —
 * and every interaction is a tool call, so anything the page cannot offer is
 * a gap the agent has too. Two logs record that: the verbs used, and the
 * intents that had no verb.
 *
 *   MIRVA_API_KEY=... mirva-mcp-viewer          (or: npm run viewer)
 *   MIRVA_URL selects the server, as for mirva-mcp; VIEWER_PORT the local port.
 */
import { readFileSync } from 'fs';
import { createServer } from 'http';
import { credentialsFromEnv, errorMessage, isImageResult, isTextResult, MirvaClient } from '../transport.js';
/** The page, kept beside its README; the same path from the sources and from the build. */
const pageUrl = new URL('../../viewer/index.html', import.meta.url);
const port = Number(process.env.VIEWER_PORT || 5177);
const bridge = process.env.MIRVA_URL || 'https://mirva.ai';
const client = new MirvaClient({ url: bridge, ...credentialsFromEnv() });
/** Every tool call the page made, newest last: what the agent would have done. */
const verbs = [];
/** Every intent the page could not satisfy with a tool: what the agent cannot do. */
const gaps = [];
function isImageBytes(value) {
    return typeof value === 'object' && value !== null && Buffer.isBuffer(value.image);
}
/** A tool's payload with the transport's envelopes taken off; an image comes back as bytes. */
async function tool(name, args) {
    const started = Date.now();
    try {
        const result = await client.call('callTool', name, args);
        verbs.push({ name, args, ms: Date.now() - started, ok: true, at: new Date().toISOString() });
        if (isImageResult(result)) {
            const bytes = { image: Buffer.from(result.data, 'base64'), mimeType: result.mimeType ?? 'image/png' };
            return bytes;
        }
        if (isTextResult(result)) {
            try {
                return JSON.parse(result.text);
            }
            catch {
                return result.text;
            }
        }
        return result;
    }
    catch (e) {
        verbs.push({ name, args, ms: Date.now() - started, ok: false, error: errorMessage(e), at: new Date().toISOString() });
        throw e;
    }
}
function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}
async function readBody(req) {
    const chunks = [];
    for await (const chunk of req)
        chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    const parsed = text ? JSON.parse(text) : {};
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
}
const num = (q, key) => {
    const value = q.get(key);
    return value === null ? undefined : Number(value);
};
createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const q = url.searchParams;
    try {
        if (url.pathname === '/' || url.pathname === '/index.html') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(readFileSync(pageUrl));
        }
        else if (url.pathname === '/favicon.ico') {
            res.writeHead(204);
            res.end();
        }
        else if (url.pathname === '/api/tools') {
            json(res, 200, await client.call('listTools'));
        }
        else if (url.pathname === '/api/drawings') {
            json(res, 200, await tool('list_drawings', { limit: num(q, 'limit') ?? 50 }));
        }
        else if (url.pathname === '/api/open') {
            json(res, 200, await tool('open_drawing', { shortId: q.get('shortId') }));
        }
        else if (url.pathname === '/api/elements') {
            const region = q.has('x') ? { x: num(q, 'x'), y: num(q, 'y'), w: num(q, 'w'), h: num(q, 'h') } : {};
            json(res, 200, await tool('list_board_elements', { boardId: q.get('boardId'), ...region }));
        }
        else if (url.pathname === '/api/comments') {
            json(res, 200, await tool('list_comments', { drawingId: q.get('drawingId') }));
        }
        else if (url.pathname === '/api/capture') {
            const rect = q.has('x') ? { rect: { x: num(q, 'x'), y: num(q, 'y'), w: num(q, 'w'), h: num(q, 'h') } } : {};
            const captured = await tool('capture_drawing', { shortId: q.get('shortId'), maxDim: num(q, 'maxDim') ?? 1024, layerId: num(q, 'layerId'), ...rect });
            if (!isImageBytes(captured))
                return json(res, 502, { error: 'capture returned no image', result: captured });
            res.writeHead(200, { 'Content-Type': captured.mimeType, 'Cache-Control': 'no-store' });
            res.end(captured.image);
        }
        else if (url.pathname === '/api/call' && req.method === 'POST') {
            // Any verb the bridge offers, with the page's arguments, logged like the rest.
            const { name, args } = await readBody(req);
            if (typeof name !== 'string')
                return json(res, 400, { error: 'name is required' });
            const callArgs = typeof args === 'object' && args !== null ? args : {};
            json(res, 200, { result: await tool(name, callArgs) });
        }
        else if (url.pathname === '/api/log') {
            json(res, 200, { verbs, gaps });
        }
        else if (url.pathname === '/api/gap' && req.method === 'POST') {
            const gap = await readBody(req);
            gaps.push({ ...gap, at: new Date().toISOString() });
            json(res, 200, { recorded: gaps.length });
        }
        else {
            json(res, 404, { error: 'not found' });
        }
    }
    catch (e) {
        json(res, 500, { error: errorMessage(e) });
    }
}).listen(port, () => console.log(`MCP board viewer on http://localhost:${port} (bridge ${bridge})`));
