# @mirva/sdk

Client for [Mirva](https://mirva.ai): your boards and canvases from your own code, over one WebSocket. It is the
client the [Mirva MCP server](../mcp) is built on, so a script and an agent get the same tools with the same
permissions.

```bash
npm install @mirva/sdk
```

```ts
import { writeFile } from 'node:fs/promises';
import { Mirva } from '@mirva/sdk';

const mirva = await Mirva.connect();                     // MIRVA_API_KEY from the environment

const drawings = (await mirva.tools.list_drawings()).json<{ shortId: string; name: string; type: string }[]>();
const board = drawings.find(d => d.type === 'Board');
if (!board) throw new Error('No board to work on');

await mirva.tools.add_note({ boardId: board.shortId, text: 'Shot list', x: 0, y: 0 });

const png = await mirva.capture(board.shortId, { maxDim: 1600 });
await writeFile('board.png', png.data);

const { reply, session } = await mirva.ask('Paint over the sketch in the house skill', { boardId: board.shortId });
console.log(reply.message, reply.tools);
for (const produced of reply.producedImages ?? []) {
  await writeFile(`${produced.fileId}.png`, (await session.image(produced.fileId)).data);
}

mirva.close();
```

## Connecting

`Mirva.connect(options)` opens the socket, so a wrong url or key is reported there; `new Mirva(options)` connects on
the first call instead. A dropped socket is dialled again by the next call.

| Option | Environment | Default | |
|---|---|---|---|
| `apiKey` | `MIRVA_API_KEY` | — | API key for the account to act as, from its API page. Revocable there; the credential to use. |
| `token` | `MIRVA_TOKEN` | — | Session token, as an alternative when no API key is available |
| `url` | `MIRVA_URL` | `https://mirva.ai` | Server origin |

## Tools

Every tool the server offers is a method of `mirva.tools`, with its arguments typed and documented from the server's
own tool list. Tools answer with a `ToolOutput`:

- `text`: the answer's text; most tools answer with JSON, which `json<T>()` parses
- `images` / `image`: images in the answer, decoded to a `Buffer` with their media type
- `raw`: the answer as the server sent it

The types are generated from the tool list when this package is built. `mirva.call(name, args)` reaches any tool by
name, including one newer than the build, and `mirva.listTools()` returns what the server offers now.

## Asking Mirva

`mirva.ask(message, { boardId })` starts a conversation with Mirva, scoped to the board when given one, and waits
until Mirva has answered. A turn can run tools, generate images and edit the board, which takes minutes for a render;
the reply carries what it did:

| Field | |
|---|---|
| `message` | Mirva's answer |
| `tools` | the tools it ran, in order |
| `producedImages` | the images it generated: fetch one with `session.image(fileId)` |
| `boardEdits` | what it added to the board |

`mirva.session({ boardId })` keeps one conversation for several requests, each seeing the earlier ones:

```ts
const session = await mirva.session({ boardId });
await session.ask('Block in the environment from my sketch');
await session.ask('Now a night version');
```

`ask` options: `images` (references to attach, as `Buffer`s or base64), `onMessage` (called as messages arrive),
`timeoutMs` (default 15 minutes), `pollMs` (default 2 seconds) and an abort `signal`. A turn Mirva stops or fails also
ends with a reply, saying so.

## How it works

The client speaks Deepkit RPC over a WebSocket to the server's `/api/teams/rpc` endpoint, the protocol Mirva's own web
client uses. Every call runs on the server as the account whose credential you configured, with the web app's
permission checks. `MirvaClient`, the connection underneath, is exported for calls to the RPC controller directly.

## Security

Either credential acts as the account: treat it like a password. An API key can be revoked from the account's API
page without touching the session; a session token cannot, which is why the key is the one to hand out.
