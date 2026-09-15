/**
 * Deepkit RPC over a WebSocket, authenticated as a Mirva user.
 *
 * The server speaks Deepkit RPC to its own web client, so this client is on
 * the same protocol rather than a translation of it. Controllers are
 * addressed by their string path, which needs no type reflection.
 */

import { RpcClient, type ClientTransportAdapter, type TransportClientConnection } from '@deepkit/rpc';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import WebSocket, { type RawData } from 'ws';

/**
 * One of: a session token, sent as the AUTH_TOKEN cookie a browser session
 * carries; or an API key, sent as a bearer credential the way the public API
 * takes it. The key is preferred when both are given.
 */
export interface Credentials {
  token?: string;
  apiKey?: string;
}

export interface MirvaClientOptions extends Credentials {
  /** http(s) or ws(s) origin of the server, or its RPC endpoint. */
  url: string;
  /** Controller path; the bridge is the default. */
  controller?: string;
}

/** A tool's text answer, as the bridge returns it. */
export interface TextResult {
  type: 'text';
  text: string;
}

/** A tool's image answer: base64 bytes and their media type. */
export interface ImageResult {
  type: 'image';
  data: string;
  mimeType?: string;
}

export function isTextResult(result: unknown): result is TextResult {
  return typeof result === 'object' && result !== null
    && (result as TextResult).type === 'text' && typeof (result as TextResult).text === 'string';
}

export function isImageResult(result: unknown): result is ImageResult {
  return typeof result === 'object' && result !== null
    && (result as ImageResult).type === 'image' && typeof (result as ImageResult).data === 'string';
}

/** The bridge controller's actions, as the server declares them. */
export interface McpRemote {
  listTools(): Promise<Tool[]>;
  toolsDigest(): Promise<string>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

class WebSocketAdapter implements ClientTransportAdapter {
  private readonly url: string;
  private readonly credentials: Credentials;

  constructor(url: string, credentials: Credentials) {
    this.url = url;
    this.credentials = credentials;
  }

  connect(connection: TransportClientConnection): void {
    const { token, apiKey } = this.credentials;
    const socket = new WebSocket(this.url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : { Cookie: `AUTH_TOKEN=${token}` },
    });
    socket.binaryType = 'arraybuffer';

    socket.on('message', (data: RawData) => {
      connection.readBinary(new Uint8Array(data as ArrayBuffer));
    });
    socket.on('close', () => connection.onClose('socket closed'));
    socket.on('error', (error: Error) => connection.onError(error));
    socket.on('open', () => {
      connection.onConnected({
        clientAddress: () => this.url,
        bufferedAmount: () => socket.bufferedAmount,
        close: () => socket.close(),
        writeBinary: (message: Uint8Array) => socket.send(message),
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
  readonly url: string;
  private readonly credentials: Credentials;
  private readonly controllerPath: string;
  rpc: RpcClient | undefined;
  private remote: McpRemote | undefined;

  constructor(options: MirvaClientOptions) {
    this.url = toWebSocketUrl(options.url);
    this.credentials = { token: options.token, apiKey: options.apiKey };
    this.controllerPath = options.controller ?? 'rpc-mcp';
  }

  /**
   * Connect if needed. The controller handle is NOT returned from an async
   * function: it is a Proxy that answers every property, so awaiting it
   * makes the runtime read `then` and the server rejects an action by that
   * name. Callers go through `call` after awaiting this.
   */
  async ensureConnected(): Promise<void> {
    if (this.remote) return;
    const rpc = new RpcClient(new WebSocketAdapter(this.url, this.credentials));
    await rpc.connect();
    this.rpc = rpc;
    this.remote = rpc.controller<McpRemote>(this.controllerPath);
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
  async call<K extends keyof McpRemote>(method: K, ...args: Parameters<McpRemote[K]>): Promise<Awaited<ReturnType<McpRemote[K]>>> {
    await this.ensureConnected();
    const remote = this.remote as McpRemote;
    const action = remote[method] as (...a: Parameters<McpRemote[K]>) => ReturnType<McpRemote[K]>;
    return await action(...args);
  }

  reset(): void {
    try {
      this.rpc?.disconnect();
    } catch { /* already gone */ }
    this.rpc = undefined;
    this.remote = undefined;
  }

  close(): void {
    this.reset();
  }
}

/** The server's Deepkit RPC endpoint, the one its own web client dials. */
const RPC_PATH = '/api/teams/rpc';

/** Accepts an http(s) or ws(s) origin and returns the RPC endpoint. */
function toWebSocketUrl(url: string): string {
  const normalized = url.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:').replace(/\/$/, '');
  return normalized.endsWith(RPC_PATH) ? normalized : `${normalized}${RPC_PATH}`;
}

/**
 * The credential the environment configures: MIRVA_API_KEY (an API key from
 * the account's API page — revocable, and the one to use) or MIRVA_TOKEN (a
 * session token). Returns an empty object when neither is set.
 */
export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): Credentials {
  if (env.MIRVA_API_KEY) return { apiKey: env.MIRVA_API_KEY };
  if (env.MIRVA_TOKEN) return { token: env.MIRVA_TOKEN };
  return {};
}

/** The message of a thrown value, for a report that never shows a stack. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
