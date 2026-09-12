# MCP board viewer

A page whose every pixel and every action comes through the same MCP bridge
and API key an agent uses. The board is never rendered locally: it is the
PNG `capture_drawing` returns for the visible region, refreshed as you pan
and zoom. Elements come from `list_board_elements`; clicking one opens an
inspector whose buttons are the verbs that apply to it. A button for
something an agent cannot do is a **gap** button: pressing it records the
intent instead of doing anything.

Two logs, both on the page: the verbs used, and the intents with no verb.
The coverage panel grades the bridge's tool list against what this page can
exercise and against the browser's own layer actions.

    MIRVA_URL=http://localhost:4000 MIRVA_API_KEY=... node viewer/server.mjs
    open http://localhost:5177

The key never reaches the page: the local server holds it and proxies calls.
This build is read-only — captures, elements, comments, layers — with the
editing verbs listed but not wired.
