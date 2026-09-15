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
- **Toolbar** — the editor's pointer tools, each a verb on release: brush,
  eraser and line (`draw_shapes`), rectangle and ellipse (`draw_shape`),
  text (`draw_text`), bucket (`fill_area`), eyedropper (`pick_color`),
  select rect / ellipse / lasso (`select_*`), paste image (`paste_image`
  into the dragged rect), and all / none / invert / delete selected. The
  preset list is `list_brush_presets`.
  A stroke shows on the picture the moment it ends, in the brush's own
  colour and size, and stays until the capture that holds it lands; strokes
  made while the bridge is busy go together as one `draw_shapes` call, and
  the picture catches up once per batch. A pen's pressure travels with the
  points. Shortcuts as in the editor: V B E L R O T G I M Q pick the tool,
  `[` and `]` change the size, space or the middle button pans in any tool,
  Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z undo and redo, Cmd/Ctrl+A and Cmd/Ctrl+D
  select all and none, Delete erases the selection, Enter closes a lasso,
  Escape drops it.
- **Chat** — `create_ai_session`, `send_message` (with an image), `get_messages`,
  `read_message_image` and `undo_agent_edits` on an agent reply.
- **Verbs** — every tool the bridge offers as a form built from its own
  schema, prefilled from the open drawing, the selected layer and the view;
  the answer is shown, images included. Nothing the bridge offers is
  unreachable from the page.

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

    MIRVA_API_KEY=... npx -y -p github:mirva-ai/mirva-mcp#release mirva-mcp-viewer     # or, in this repo: npm run viewer
    open http://localhost:5177

MIRVA_URL picks the server (default https://mirva.ai, as for mirva-mcp) and
VIEWER_PORT the local port.

The key never reaches the page: the local server holds it and proxies calls
(`POST /api/call` runs any verb with the page's arguments and logs it).
