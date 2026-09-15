# mirva-mcp

MCP server for [Mirva](https://mirva.ai). Lets an MCP client — Claude Code,
Claude Desktop, or anything else speaking the protocol — work on your boards
and canvases with your own account.

## Install

Nothing to install: MCP clients run it on demand straight from this repository (an npm release follows).

```json
{
  "mcpServers": {
    "mirva": {
      "command": "npx",
      "args": ["-y", "github:mirva-ai/mirva-mcp#release"],
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

This package is a protocol translator and nothing more. Every operation
runs server-side in a session that acts with the authority of the account
whose credential you configured — the same permission checks that guard that
user in the web app, because it is the same API. Nothing here renders,
stores, or bypasses anything.

That also keeps the package small: no native modules and no database, so
`npx` works anywhere Node 20+ does.

The `release` branch and the `vX.Y.Z` tags hold the built package; `main`
holds the TypeScript source and is not installable, because Node does not
run TypeScript from inside an installed package. Pin a tag
(`github:mirva-ai/mirva-mcp#v0.2.4`) to stay on one version, or `#release`
to follow the latest build.

## Viewer

A browser page that shows a board exactly as an agent gets it and drives it
with the same tools: every pixel is a `capture_drawing` PNG and every click
is a tool call, so what the page cannot do, the agent cannot do either. It
is the way to see what the bridge will do before an agent does it, and to
find the gaps.

```
MIRVA_API_KEY=your-api-key npx -y -p github:mirva-ai/mirva-mcp#release mirva-mcp-viewer
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

## Tools

`tools/audit-board.mjs` reads a board and reports three faults that are
hard to see by eye: a canvas referenced by more than one layer — a move
that left its old layer behind — cards overlapping each other, and cards
sitting outside every section.

```bash
MIRVA_URL=http://localhost:8080 MIRVA_API_KEY=<key> \
  node tools/audit-board.mjs <boardId>
```

It lists the whole board rather than a region on purpose. A region answers
only what is inside it, and each of these faults is about something being
somewhere you did not think to look.

## Testing

`npm test` runs the geometry behind that audit — seventeen cases covering
the pairs that would otherwise pass falsely, such as cards that abut
without overlapping, and a card overhanging the section it looks like it is
in. It needs no server.

`test/hard-cases.mjs` exercises the surface adversarially against a running
server — malformed arguments, absent and unreadable ids, oversized and
unicode input, bound clamping, concurrency, socket loss, and bad tokens.

```bash
MIRVA_URL=http://localhost:8080 \
MIRVA_API_KEY=<account key> \
MIRVA_OUTSIDER_TOKEN=<second account, no shared membership> \
MIRVA_BOARD=<a board shortId the account can see> \
  node test/hard-cases.mjs
```

`MIRVA_BOARD` enables the board-composition cases, which check that the
board tools refuse an unknown board, a half-specified region, a
zero-sized section, a nonexistent drawing and an unknown layer. They only
read and refuse — nothing in the suite writes to the board you name.

`MIRVA_OUTSIDER_TOKEN` enables the cross-account cases, which assert that
one account cannot read another's drawings or chats and that refusal is
byte-identical to not-found — so the tools cannot be used to discover what
exists. They are the cases worth keeping honest: removing the server's
permission check makes them fail.

## License

MIT

## Development

The source is TypeScript and runs directly under Node 24 (`node src/index.ts`,
`npm run viewer`, `node tools/soak.ts …`); `npm run check` type-checks the
sources, tools and tests, `npm test` runs the geometry tests, and
`test/hard-cases.ts` exercises a live server. `npm run build` emits `dist/`,
which is never committed. A release is `npm version <x.y.z>` followed by
`npm run release`, which type-checks, builds, and publishes the built package
to the `release` branch and a version tag with publish-to-git. The build runs
as the package is packed, so a Git install of a published payload runs no
build of its own. The commands in `bin/` run `dist/` when it exists and the
sources otherwise, which serves a checkout without a build; an install
cannot take that path, since Node refuses TypeScript under node_modules.
