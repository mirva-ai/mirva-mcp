/**
 * Deepkit RPC over a WebSocket, authenticated as a Mirva user.
 *
 * The server speaks Deepkit RPC to its own web client, so this client is on
 * the same protocol rather than a translation of it. Controllers are
 * addressed by their string path, which needs no type reflection — the
 * package stays plain JavaScript with no build step.
 */

import { RpcClient } from '@deepkit/rpc';
import WebSocket from 'ws';

class WebSocketAdapter {
  /**
   * @param {string} url  ws:// or wss:// endpoint
   * @param {string} token  session token, sent as the AUTH_TOKEN cookie —
   *   the same credential a browser session carries
   */
  constructor(url, token) {
    this.url = url;
    this.token = token;
  }

  async connect(connection) {
    const socket = new WebSocket(this.url, {
      headers: { Cookie: `AUTH_TOKEN=${this.token}` },
    });
    socket.binaryType = 'arraybuffer';

    socket.on('message', data => {
      connection.readBinary(new Uint8Array(data));
    });
    socket.on('close', () => connection.onClose('socket closed'));
    socket.on('error', error => connection.onError(error));
    socket.on('open', () => {
      connection.onConnected({
        clientAddress: () => this.url,
        bufferedAmount: () => socket.bufferedAmount,
        close: () => socket.close(),
        writeBinary: message => socket.send(message),
      });
    });
  }
}

/**
 * A connected client. Lazily dials on first use so a misconfigured server
 * reports its reason on a tool call rather than at startup, where an MCP
 * client would surface it only as a failed handshake.
 */
export class MirvaClient {
  /**
   * @param {{ url: string, token: string, controller?: string }} options
   */
  constructor(options) {
    this.url = toWebSocketUrl(options.url);
    this.token = options.token;
    this.controllerPath = options.controller ?? 'mirva/mcp';
    this.rpc = undefined;
    this.remote = undefined;
  }

  /** The remote controller, connecting on first use. */
  async controller() {
    if (this.remote) return this.remote;
    this.rpc = new RpcClient(new WebSocketAdapter(this.url, this.token));
    await this.rpc.connect();
    this.remote = this.rpc.controller(this.controllerPath);
    return this.remote;
  }

  /**
   * Call a controller method, redialing once if the connection has gone
   * away. Sessions idle out server-side, so a long-lived MCP client will
   * outlive its socket; a transparent retry keeps that invisible to the
   * model rather than surfacing as a spurious tool failure.
   */
  async call(method, ...args) {
    try {
      const remote = await this.controller();
      return await remote[method](...args);
    } catch (e) {
      if (!isConnectionError(e)) throw e;
      this.reset();
      const remote = await this.controller();
      return await remote[method](...args);
    }
  }

  reset() {
    try {
      this.rpc?.disconnect();
    } catch { /* already gone */ }
    this.rpc = undefined;
    this.remote = undefined;
  }

  close() {
    this.reset();
  }
}

function isConnectionError(e) {
  const message = String(e?.message ?? e);
  return /offline|closed|socket|ECONNRESET|ECONNREFUSED|not connected/i.test(message);
}

/** The server's Deepkit RPC endpoint, the one its own web client dials. */
const RPC_PATH = '/api/teams/rpc';

/** Accepts an http(s) or ws(s) origin and returns the RPC endpoint. */
function toWebSocketUrl(url) {
  const normalized = url.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:').replace(/\/$/, '');
  return normalized.endsWith(RPC_PATH) ? normalized : `${normalized}${RPC_PATH}`;
}
