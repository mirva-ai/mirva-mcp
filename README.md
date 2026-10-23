# Mirva for developers

Two packages for working with [Mirva](https://mirva.ai) boards and canvases from outside the browser, with your own
account:

| Package | | |
|---|---|---|
| [`@mirva/mcp`](packages/mcp) | MCP server | Lets an MCP client (Claude Code, Claude Desktop, Cursor, Codex…) work on your boards. Start here for an AI agent. |
| [`@mirva/sdk`](packages/sdk) | Client library | The same tools from your own Node code, over one WebSocket. The MCP server is built on it. |

## Tools

`tools/audit-board.ts` reads a board and reports three faults that are
hard to see by eye: a canvas referenced by more than one layer — a move
that left its old layer behind — cards overlapping each other, and cards
sitting outside every section.

```bash
MIRVA_URL=http://localhost:8080 MIRVA_API_KEY=<key> \
  node tools/audit-board.ts <boardId>
```

It lists the whole board rather than a region on purpose. A region answers
only what is inside it, and each of these faults is about something being
somewhere you did not think to look.

`tools/call.ts <tool> '<json>'` calls one tool and prints its answer; `tools/soak.ts` and `tools/bench.ts` load a
server with repeated calls.

## Testing

`npm test` runs the geometry behind that audit — seventeen cases covering
the pairs that would otherwise pass falsely, such as cards that abut
without overlapping, and a card overhanging the section it looks like it is
in. It needs no server.

`test/hard-cases.ts` exercises the surface adversarially against a running
server — malformed arguments, absent and unreadable ids, oversized and
unicode input, bound clamping, concurrency, socket loss, and bad tokens.

```bash
MIRVA_URL=http://localhost:8080 \
MIRVA_API_KEY=<account key> \
MIRVA_OUTSIDER_TOKEN=<second account, no shared membership> \
MIRVA_BOARD=<a board shortId the account can see> \
  node test/hard-cases.ts
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

## Development

An npm workspace: `npm install` at the root links `@mirva/sdk` into the MCP package. The source is TypeScript and
runs directly under Node 24.

- `npm start` and `npm run viewer` run the MCP server and the viewer from source. They pass `--conditions=source`, which
  makes `@mirva/sdk` resolve to its TypeScript source rather than its build.
- `node tools/…` and `node test/…` import the SDK source by path and need no flag.
- `npm run check` type-checks both packages, the tools and the tests; `npm test` runs the geometry tests.
- `npm run build` emits each package's `dist/`, which is never committed. The MCP build compiles against the SDK's
  declarations, as an install sees them.

## Releasing

Each package is released on its own, from a tag: bump its `version`, commit, and push `sdk-vX.Y.Z` or `mcp-vX.Y.Z`.
The Publish workflow checks that the tag matches the package's version, type-checks, tests, builds and publishes to
npm. It authenticates through npm trusted publishing, so no npm token is stored anywhere. A release of `@mirva/mcp`
that needs a newer SDK goes out after that SDK release, with its dependency range raised.
