/**
 * Call one MCP tool and print its result.
 *
 * The board is built through the product's own tools, so nearly every step
 * of a session is one of these calls. This lived in a scratch directory
 * twice and was lost both times, taking the session's only way to reach the
 * product with it — it belongs with the client it drives.
 *
 * An image result is written to a file rather than printed: the payload is
 * base64 and would bury the rest of the output.
 *
 * Usage:
 *   MIRVA_URL=... MIRVA_TOKEN=... node tools/call.mjs <tool> '<json args>'
 *
 * Options via env:
 *   FULL=1        print the whole result rather than the first lines
 *   RAW=1         print the tool's own payload with the envelopes removed
 *   IMAGE_OUT=... where an image result is written (default /tmp/capture.png)
 */
import { writeFileSync } from 'fs';
import { MirvaClient } from '../src/transport.mjs';

const [tool, argsJson] = process.argv.slice(2);
if (!tool) {
  console.error("usage: node tools/call.mjs <tool> '<json args>'");
  process.exit(2);
}

let args = {};
if (argsJson) {
  try {
    args = JSON.parse(argsJson);
  } catch (e) {
    // A malformed argument string is the caller's own quoting, and saying so
    // beats a stack trace from inside the transport.
    console.error(`arguments are not valid JSON: ${e.message}`);
    process.exit(2);
  }
}

const client = new MirvaClient({
  url: process.env.MIRVA_URL || 'http://localhost:4000',
  token: process.env.MIRVA_TOKEN || '',
});

const timer = setTimeout(() => { console.error('TIMEOUT'); process.exit(2); }, 85000);
try {
  const result = await client.call('callTool', tool, args);
  const image = result?.data && /^image\//.test(result.mimeType || '');
  if (image) {
    const out = process.env.IMAGE_OUT || '/tmp/capture.png';
    const bytes = Buffer.from(result.data, 'base64');
    writeFileSync(out, bytes);
    console.log(`IMAGE -> ${out} (${Math.round(bytes.length / 1024)}KB)`);
  } else if (process.env.RAW) {
    // A tool's own payload, with the transport's envelopes taken off. Most
    // results arrive as {type, text} where text is itself JSON, so reading
    // one means unwrapping twice — and a caller that unwraps once feeds an
    // envelope back into the next call. Writing a document that way nested
    // the whole envelope inside the document it was meant to edit.
    const inner = typeof result?.text === 'string' ? result.text : null;
    let payload = result;
    if (inner !== null) {
      try {
        payload = JSON.parse(inner);
      } catch {
        payload = inner; // plain text, not JSON — hand it back as it came
      }
    }
    console.log(typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));
  } else {
    const text = JSON.stringify(result, null, 2);
    console.log(process.env.FULL ? text : text.slice(0, 2000));
  }
} catch (e) {
  // The product's own refusals are answers, not crashes: a caller reads
  // "Drawing not found" the same way it reads a result.
  console.log(`FAILED: ${e?.message ?? e}`);
  process.exit(1);
} finally {
  clearTimeout(timer);
  client.close();
}
