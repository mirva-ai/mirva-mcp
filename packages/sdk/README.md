# @mirva/sdk

Client for [Mirva](https://mirva.ai): call the tools your account has on its boards and canvases from your own code,
over one WebSocket. It is the client the [Mirva MCP server](../mcp) uses, so a script and an agent get the same tools
with the same permissions.

```bash
npm install @mirva/sdk
```

```ts
import { MirvaClient, credentialsFromEnv, isTextResult } from '@mirva/sdk';

const client = new MirvaClient({ url: 'https://mirva.ai', ...credentialsFromEnv() });

const tools = await client.call('listTools');
console.log(tools.map(t => t.name));

const result = await client.call('callTool', 'list_drawings', {});
for (const part of Array.isArray(result) ? result : [result]) {
  if (isTextResult(part)) console.log(part.text);
}

client.close();
```

| Variable | |
|---|---|
| `MIRVA_API_KEY` | API key for the account to act as, from its API page. Revocable there; the credential to use. |
| `MIRVA_TOKEN` | Session token, as an alternative when no API key is available |

`credentialsFromEnv()` reads them; pass `apiKey` or `token` to `MirvaClient` directly otherwise.

## How it works

The client speaks Deepkit RPC over a WebSocket to the server's `/api/teams/rpc` endpoint, the protocol Mirva's own web
client uses. It connects on the first call. A dropped socket is dialled again by the next call.

Every call runs on the server as the account whose credential you configured: the permission checks are the web app's.
The tools come from the server (`listTools`), so the client always has the ones the server offers today.

## Security

Either credential acts as the account: treat it like a password. An API key can be revoked from the account's API
page without touching the session; a session token cannot, which is why the key is the one to hand out.
