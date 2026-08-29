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

## Tools

`tools/audit-board.mjs` reads a board and reports three faults that are
hard to see by eye: a canvas referenced by more than one layer — a move
that left its old layer behind — cards overlapping each other, and cards
sitting outside every section.

```bash
MIRVA_URL=http://localhost:8080 MIRVA_TOKEN=<token> \
  node tools/audit-board.mjs <boardId>
```

It lists the whole board rather than a region on purpose. A region answers
only what is inside it, and each of these faults is about something being
somewhere you did not think to look.

`npm run check-board -- <boardId> [<prefix>=<count> ...]` runs both board
tools in one pass and exits non-zero if either fails. Run separately they
tend to be run one at a time, which is how a fault in the other one
survives.

`tools/verify-claims.mjs` checks that a section still holds what it is
supposed to. A section's name is a claim, and claims drift as work moves
around.

```bash
MIRVA_URL=http://localhost:8080 MIRVA_TOKEN=<token> \
  node tools/verify-claims.mjs <boardId> 10=36 11=12 04=document:2
```

A bare count means everything the section holds; prefixing a type —
`canvas`, `document`, `sticky` — pins down one kind, which is what a
section holding both a document and a card needs. It exits non-zero when a
claim does not match, so it can gate a script.

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
MIRVA_TOKEN=<account token> \
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
