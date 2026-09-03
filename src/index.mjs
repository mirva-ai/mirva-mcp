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
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { credentialsFromEnv, MirvaClient } from './transport.mjs';

const url = process.env.MIRVA_URL || 'https://mirva.ai';
const credentials = credentialsFromEnv();

function usage(message) {
  console.error(`mirva-mcp: ${message}

  MIRVA_API_KEY API key for the account to act as (from its API page; preferred)
  MIRVA_TOKEN   session token, as an alternative to an API key
  MIRVA_URL     server origin (default https://mirva.ai)

Configure in an MCP client, e.g. .mcp.json:

  {
    "mcpServers": {
      "mirva": {
        "command": "npx",
        "args": ["-y", "mirva-mcp"],
        "env": { "MIRVA_API_KEY": "..." }
      }
    }
  }
`);
  process.exit(1);
}

async function main() {
  if (!credentials.apiKey && !credentials.token) usage('MIRVA_API_KEY (or MIRVA_TOKEN) is required');

  const client = new MirvaClient({ url, ...credentials });
  const server = new Server(
    { name: 'mirva', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await client.call('listTools');
    return { tools: tools ?? [] };
  });

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params;
    try {
      const result = await client.call('callTool', name, args ?? {});
      return { content: normalizeContent(result) };
    } catch (e) {
      // A failed call reports its reason to the model instead of killing the
      // connection: the caller can usually correct the request and retry.
      return { content: [{ type: 'text', text: `FAILED: ${e?.message ?? e}` }], isError: true };
    }
  });

  const shutdown = () => {
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
function normalizeContent(result) {
  if (result == null) return [{ type: 'text', text: 'OK' }];
  if (Array.isArray(result?.content)) return result.content;
  if (result?.type === 'image' && result.data) {
    return [{ type: 'image', data: result.data, mimeType: result.mimeType ?? 'image/png' }];
  }
  // The server already answers in MCP's own content shape; passing it
  // through unwrapped keeps the model from reading a JSON envelope around
  // every value.
  if (result?.type === 'text') return [{ type: 'text', text: result.text ?? '' }];
  if (typeof result === 'string') return [{ type: 'text', text: result }];
  return [{ type: 'text', text: JSON.stringify(result, null, 2) }];
}

main().catch(e => {
  console.error(`mirva-mcp: ${e?.message ?? e}`);
  process.exit(1);
});
