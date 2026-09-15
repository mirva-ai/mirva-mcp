#!/usr/bin/env node
/**
 * Mirva MCP server.
 *
 * A protocol translator: MCP over stdio on one side, Deepkit RPC over a
 * WebSocket on the other. All work happens server-side in a session that
 * acts with the authority of the account whose token is configured, so this
 * process carries no rendering, no database, and no native dependencies.
 *
 * The tool list is fetched from the server rather than declared here: the
 * capabilities belong to the product, and a client that hardcoded them
 * would drift from whatever the server actually offers.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'module';
import { credentialsFromEnv, errorMessage, isImageResult, isTextResult, MirvaClient } from './transport.ts';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
const url = process.env.MIRVA_URL || 'https://mirva.ai';
const credentials = credentialsFromEnv();

function usage(message: string): never {
  console.error(`mirva-mcp: ${message}

  MIRVA_API_KEY API key for the account to act as (from its API page; preferred)
  MIRVA_TOKEN   session token, as an alternative to an API key
  MIRVA_URL     server origin (default https://mirva.ai)

Configure in an MCP client, e.g. .mcp.json:

  {
    "mcpServers": {
      "mirva": {
        "command": "npx",
        "args": ["-y", "github:mirva-ai/mirva-mcp#release"],
        "env": { "MIRVA_API_KEY": "..." }
      }
    }
  }
`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!credentials.apiKey && !credentials.token) usage('MIRVA_API_KEY (or MIRVA_TOKEN) is required');

  const client = new MirvaClient({ url, ...credentials });
  const server = new Server(
    { name: 'mirva', version },
    { capabilities: { tools: { listChanged: true } } },
  );

  // The server builds its tool set once per build, so the list this
  // process served can go stale only across a reconnect — after a deploy.
  // Rather than a synthetic change event, the server's digest of its set is
  // compared, after a call and at most once per interval, to the digest of
  // the list last served; a difference is announced, and the client
  // re-lists. A server without the digest action is simply never announced.
  let servedDigest: string | undefined;
  let lastDigestCheck = 0;
  const DIGEST_CHECK_INTERVAL_MS = 30_000;
  const announceIfChanged = async (): Promise<void> => {
    if (!servedDigest || Date.now() - lastDigestCheck < DIGEST_CHECK_INTERVAL_MS) return;
    lastDigestCheck = Date.now();
    try {
      const current = await client.call('toolsDigest');
      if (current && current !== servedDigest) {
        servedDigest = undefined;
        await server.sendToolListChanged();
      }
    } catch { /* an older server, or a dropped socket: nothing to announce */ }
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await client.call('listTools');
    try { servedDigest = await client.call('toolsDigest'); } catch { servedDigest = undefined; }
    lastDigestCheck = Date.now();
    return { tools: tools ?? [] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;
    try {
      const result = await client.call('callTool', name, args ?? {});
      void announceIfChanged();
      return { content: normalizeContent(result) };
    } catch (e) {
      // A failed call reports its reason to the model instead of killing the
      // connection: the caller can usually correct the request and retry.
      return { content: [{ type: 'text', text: `FAILED: ${errorMessage(e)}` }], isError: true };
    }
  });

  const shutdown = (): void => {
    client.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(new StdioServerTransport());
  console.error(`mirva-mcp: ready (${url})`);
}

/**
 * Server results arrive as plain values; images arrive as
 * `{ type: 'image', data, mimeType }` so a capture renders in the client
 * rather than printing as base64.
 */
function normalizeContent(result: unknown): CallToolResult['content'] {
  if (result == null) return [{ type: 'text', text: 'OK' }];
  if (typeof result === 'object' && Array.isArray((result as { content?: unknown }).content)) {
    return (result as { content: CallToolResult['content'] }).content;
  }
  if (isImageResult(result)) {
    return [{ type: 'image', data: result.data, mimeType: result.mimeType ?? 'image/png' }];
  }
  // The server already answers in MCP's own content shape; passing it
  // through unwrapped keeps the model from reading a JSON envelope around
  // every value.
  if (isTextResult(result)) return [{ type: 'text', text: result.text }];
  if (typeof result === 'string') return [{ type: 'text', text: result }];
  return [{ type: 'text', text: JSON.stringify(result, null, 2) }];
}

main().catch((e: unknown) => {
  console.error(`mirva-mcp: ${errorMessage(e)}`);
  process.exit(1);
});
