/**
 * Deepkit RPC over a WebSocket, authenticated as a Mirva user.
 *
 * The server speaks Deepkit RPC to its own web client, so this client is on
 * the same protocol rather than a translation of it. Controllers are
 * addressed by their string path, which needs no type reflection.
 */
import { RpcClient } from '@deepkit/rpc';
import WebSocket, {} from 'ws';
export function isTextResult(result) {
    return typeof result === 'object' && result !== null
        && result.type === 'text' && typeof result.text === 'string';
}
export function isImageResult(result) {
    return typeof result === 'object' && result !== null
        && result.type === 'image' && typeof result.data === 'string';
}
class WebSocketAdapter {
    url;
    credentials;
    constructor(url, credentials) {
        this.url = url;
        this.credentials = credentials;
    }
    connect(connection) {
        const { token, apiKey } = this.credentials;
        const socket = new WebSocket(this.url, {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : { Cookie: `AUTH_TOKEN=${token}` },
        });
        socket.binaryType = 'arraybuffer';
        socket.on('message', (data) => {
            connection.readBinary(new Uint8Array(data));
        });
        socket.on('close', () => connection.onClose('socket closed'));
        socket.on('error', (error) => connection.onError(error));
        socket.on('open', () => {
            connection.onConnected({
                clientAddress: () => this.url,
                bufferedAmount: () => socket.bufferedAmount,
                close: () => socket.close(),
                writeBinary: (message) => socket.send(message),
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
    url;
    credentials;
    controllerPath;
    rpc;
    remote;
    constructor(options) {
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
    async ensureConnected() {
        if (this.remote)
            return;
        const rpc = new RpcClient(new WebSocketAdapter(this.url, this.credentials));
        await rpc.connect();
        this.rpc = rpc;
        this.remote = rpc.controller(this.controllerPath);
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
        const remote = this.remote;
        const action = remote[method];
        return await action(...args);
    }
    reset() {
        try {
            this.rpc?.disconnect();
        }
        catch { /* already gone */ }
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
/**
 * The credential the environment configures: MIRVA_API_KEY (an API key from
 * the account's API page — revocable, and the one to use) or MIRVA_TOKEN (a
 * session token). Returns an empty object when neither is set.
 */
export function credentialsFromEnv(env = process.env) {
    if (env.MIRVA_API_KEY)
        return { apiKey: env.MIRVA_API_KEY };
    if (env.MIRVA_TOKEN)
        return { token: env.MIRVA_TOKEN };
    return {};
}
/** The message of a thrown value, for a report that never shows a stack. */
export function errorMessage(e) {
    return e instanceof Error ? e.message : String(e);
}
