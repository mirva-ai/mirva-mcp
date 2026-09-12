# MCP board viewer

A page whose every pixel and every action comes through the same MCP bridge
and API key an agent uses. The drawing is never rendered locally: it is the
PNG `capture_drawing` returns for the visible region, refreshed as you pan
and zoom. Everything else on the page is a verb's answer too:

- **Layers** — `open_drawing`'s list, top first, with each row's controls
  wired to a verb: eye and lock (`set_layer`), name by double-click
  (`set_layer`), opacity (`set_layer`), arrows (`reorder_layers`). A board's
  rows carry the element kind `list_board_elements` reports. `+ layer`,
  `+ note`, `+ section` and `+ document` create at the view's centre.
  "Capture selected layer only" passes `layerId` to `capture_drawing`.
- **Selection** — the selected layer or element with the verbs that apply
  to it: blend mode and clipping, duplicate / merge down / trim / clear /
  remove and a transform form for a paint layer; place or move, note text,
  document content and "open canvas" for a board element; a comment form
  for either. Destructive buttons ask for a second click.
- **Comments** — `list_comments` threads with reply and resolve; each
  thread's anchor is marked on the picture.

Every verb re-reads the drawing (`open_drawing`) and captures it again, so
the page shows what the bridge did, not what the page assumed. A verb the
bridge refuses shows its message in the status line. Intents with no verb
are gap buttons: pressing one records the intent instead of doing anything.

The view — drawing, region, zoom, selected layer — lives in the URL, and
every capture is logged to the console with the exact `capture_drawing`
arguments, so a state can be copied and reopened as it was.

Two logs at the bottom: the verbs used, and the intents with no verb. The
coverage panel grades the bridge's tool list against the browser's own
layer actions.

    MIRVA_URL=http://localhost:4000 MIRVA_API_KEY=... node viewer/server.mjs
    open http://localhost:5177

The key never reaches the page: the local server holds it and proxies calls
(`POST /api/call` runs any verb with the page's arguments and logs it).
