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
    this.controllerPath = options.controller ?? 'rpc-mcp';
    this.rpc = undefined;
    this.remote = undefined;
  }

  /**
   * Connect if needed. The controller handle is NOT returned from an async
   * function: it is a Proxy that answers every property, so awaiting it
   * makes the runtime read `then` and the server rejects an action by that
   * name. Callers take it from `this.remote` after awaiting this.
   */
  async ensureConnected() {
    if (this.remote) return;
    this.rpc = new RpcClient(new WebSocketAdapter(this.url, this.token));
    await this.rpc.connect();
    this.remote = this.rpc.controller(this.controllerPath);
  }

  /**
   * Call a controller method.
   *
   * Reconnection is NOT handled here: Deepkit's RpcClient re-establishes a
   * dropped socket on the next call by itself, verified against a live
   * server by disconnecting mid-session and calling again. A retry wrapper
   * on top of that would never fire, so this stays a plain delegation and
   * errors reaching the caller are real ones.
   */
  async call(method, ...args) {
    await this.ensureConnected();
    return await this.remote[method](...args);
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

/** The server's Deepkit RPC endpoint, the one its own web client dials. */
const RPC_PATH = '/api/teams/rpc';

/** Accepts an http(s) or ws(s) origin and returns the RPC endpoint. */
function toWebSocketUrl(url) {
  const normalized = url.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:').replace(/\/$/, '');
  return normalized.endsWith(RPC_PATH) ? normalized : `${normalized}${RPC_PATH}`;
}
