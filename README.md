# mirva-mcp

MCP server for [Mirva](https://mirva.ai). Lets an MCP client — Claude Code,
Claude Desktop, or anything else speaking the protocol — work on your boards
and canvases with your own account.

## Install

Nothing to install: MCP clients can run it on demand.

```json
{
  "mcpServers": {
    "mirva": {
      "command": "npx",
      "args": ["-y", "mirva-mcp"],
      "env": { "MIRVA_TOKEN": "your-session-token" }
    }
  }
}
```

| Variable | Required | Default | |
|---|---|---|---|
| `MIRVA_TOKEN` | yes | — | Session token for the account to act as |
| `MIRVA_URL` | no | `https://mirva.ai` | Server origin |

## What it does

Tools are provided by the server, not declared here, so the set matches
whatever your server offers rather than whatever this package shipped with.
Typically: list and inspect drawings, join one as a live participant,
capture what is on the canvas, paint, and post to a drawing's chat.

## How it works

```
MCP client ──stdio──> mirva-mcp ──Deepkit RPC / WebSocket──> Mirva
```

This package is a protocol translator and nothing more. Every operation
runs server-side in a session that acts with the authority of the account
whose token you configured — the same permission checks that guard that
user in the web app, because it is the same API. Nothing here renders,
stores, or bypasses anything.

That also keeps the package small: no native modules, no database, no build
step, so `npx` works anywhere Node 20+ does.

## Security

The token is a full session credential — treat it like a password. Anything
this server can do, it does **as you**; it grants no authority you do not
already have, and takes none away. There is no separate agent identity and
no elevated mode.

## Testing

`test/hard-cases.mjs` exercises the surface adversarially against a running
server — malformed arguments, absent and unreadable ids, oversized and
unicode input, bound clamping, concurrency, socket loss, and bad tokens.

```bash
MIRVA_URL=http://localhost:8080 \
MIRVA_TOKEN=<account token> \
MIRVA_OUTSIDER_TOKEN=<second account, no shared membership> \
  node test/hard-cases.mjs
```

`MIRVA_OUTSIDER_TOKEN` enables the cross-account cases, which assert that
one account cannot read another's drawings or chats and that refusal is
byte-identical to not-found — so the tools cannot be used to discover what
exists. They are the cases worth keeping honest: removing the server's
permission check makes them fail.

## License

MIT
