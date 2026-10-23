# mirva-mcp

MCP server for [Mirva](https://mirva.ai). Lets an MCP client — Claude Code,
Claude Desktop, or anything else speaking the protocol — work on your boards
and canvases with your own account.

## Install

Nothing to install: MCP clients run it on demand from npm.

```json
{
  "mcpServers": {
    "mirva": {
      "command": "npx",
      "args": ["-y", "@mirva/mcp"],
      "env": { "MIRVA_API_KEY": "your-api-key" }
    }
  }
}
```

| Variable | Required | Default | |
|---|---|---|---|
| `MIRVA_API_KEY` | one of | — | API key for the account to act as, from its API page. Revocable there; the credential to use. |
| `MIRVA_TOKEN` | one of | — | Session token, as an alternative when no API key is available |
| `MIRVA_URL` | no | `https://mirva.ai` | Server origin |

## What it does

Tools are provided by the server, not declared here, so the set matches
whatever your server offers rather than whatever this package shipped with.
That is the point of the design: the capabilities belong to the product,
and a client that declared its own would drift.

What a current server offers, by area:

- **Drawings** — list and inspect them, join one as a live participant,
  capture what is on the canvas as a PNG.
- **Painting** — create canvases and layers, stroke paths and fills,
  compose images onto a canvas, and restack, copy, duplicate or remove
  layers.
- **Boards** — read what is on a board and where, draw named sections,
  move a card, document or section to a new rect, pin a sticky note and
  rewrite one, and write a rich document.
- **Working with the agent** — open a session, send a message with
  reference images attached, read the reply along with the tools it ran,
  the images it produced and the layers it added, fetch one of those
  images, and undo a turn's board edits.

## How it works

```
MCP client ──stdio──> mirva-mcp ──Deepkit RPC / WebSocket──> Mirva
```

This package is a protocol translator and nothing more: the connection is
[`@mirva/sdk`](../sdk)'s, the client your own code can use for the same tools. Every operation
runs server-side in a session that acts with the authority of the account
whose credential you configured — the same permission checks that guard that
user in the web app, because it is the same API. Nothing here renders,
stores, or bypasses anything.

That also keeps the package small: no native modules and no database, so
`npx` works anywhere Node 20+ does.

Pin a version (`@mirva/mcp@0.3.0`) to stay on one release, or leave it
unpinned to follow the latest.

## Viewer

A browser page that shows a board exactly as an agent gets it and drives it
with the same tools: every pixel is a `capture_drawing` PNG and every click
is a tool call, so what the page cannot do, the agent cannot do either. It
is the way to see what the bridge will do before an agent does it, and to
find the gaps.

```
MIRVA_API_KEY=your-api-key npx -y -p @mirva/mcp mirva-mcp-viewer
```

Then open http://localhost:5177. The key stays in the local process, which
proxies the page's calls; `MIRVA_URL` and `MIRVA_TOKEN` work as above and
`VIEWER_PORT` changes the port. [viewer/README.md](viewer/README.md)
describes the page.

## Security

Either credential acts as the account — treat it like a password. An API key
can be revoked from the account's API page without touching the session;
a session token cannot, which is why the key is the one to hand out. Anything
this server can do, it does **as you**; it grants no authority you do not
already have, and takes none away. There is no separate agent identity and
no elevated mode.

## License

MIT
