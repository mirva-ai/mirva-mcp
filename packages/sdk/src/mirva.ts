import { credentialsFromEnv, MirvaClient, type Credentials, type ToolDescriptor } from './client.ts';
import { ToolOutput, type ToolImage } from './output.ts';
import { MirvaSession, type AskOptions, type AskResult } from './session.ts';
import type { MirvaToolName, MirvaTools } from './tools.generated.ts';

/** Mirva's own server, used when no url is given */
const DEFAULT_URL = 'https://mirva.ai';

export interface MirvaOptions extends Credentials {
  /** Server origin. Default MIRVA_URL from the environment, else https://mirva.ai. */
  url?: string;
}

export interface CaptureOptions {
  /** Capture only this layer. Canvases only. */
  layerId?: number;
  /** Region to capture, in the drawing's own coordinates. */
  rect?: { x?: number; y?: number; w?: number; h?: number };
  /** Longest edge of the returned image. Default 1024. */
  maxDim?: number;
}

/**
 * A Mirva account, connected over one WebSocket. Every tool the server offers is a method of `tools`, typed from the
 * tool list this package was generated against; `call` reaches any tool by name, including ones newer than that.
 * Credentials not given are read from MIRVA_API_KEY or MIRVA_TOKEN.
 */
export class Mirva {
  readonly client: MirvaClient;
  readonly tools: MirvaTools;

  constructor(options: MirvaOptions = {}) {
    const credentials = options.apiKey || options.token ? { apiKey: options.apiKey, token: options.token } : credentialsFromEnv();
    if (!credentials.apiKey && !credentials.token) throw new Error('No credentials: pass apiKey, or set MIRVA_API_KEY');
    this.client = new MirvaClient({ url: options.url ?? process.env.MIRVA_URL ?? DEFAULT_URL, ...credentials });
    this.tools = new Proxy({} as MirvaTools, {
      get: (_target, name) => {
        // awaiting the object reads `then`: it is not a tool
        if (typeof name !== 'string' || name === 'then') return undefined;
        return (args?: Record<string, unknown>) => this.call(name, args);
      },
    });
  }

  /** Connect now rather than on the first call, so a wrong url or credential is reported here. */
  static async connect(options: MirvaOptions = {}): Promise<Mirva> {
    const mirva = new Mirva(options);
    await mirva.client.ensureConnected();
    return mirva;
  }

  /** Run a tool by name. */
  call<K extends MirvaToolName>(name: K, args?: Parameters<MirvaTools[K]>[0]): Promise<ToolOutput>;
  call(name: string, args?: Record<string, unknown>): Promise<ToolOutput>;
  async call(name: string, args: object = {}): Promise<ToolOutput> {
    return new ToolOutput(await this.client.call('callTool', name, args as Record<string, unknown>));
  }

  /** The tools the server offers now. */
  listTools(): Promise<ToolDescriptor[]> {
    return this.client.call('listTools');
  }

  /** A board or canvas as it renders now, as an image (render_board). */
  async capture(shortId: string, options: CaptureOptions = {}): Promise<ToolImage> {
    const output = await this.tools.render_board({ shortId, ...options });
    const image = output.image;
    if (!image) throw new Error(`render_board returned no image: ${output.text}`);
    return image;
  }

  /**
   * Start a conversation with Mirva (create_ai_session). With a board, Mirva sees that board and its edits land on it;
   * an existing session's channel name resumes that session instead.
   */
  async session(options: { boardId?: string; channelName?: string } = {}): Promise<MirvaSession> {
    if (options.channelName) return new MirvaSession(this, options.channelName);
    const { channelName } = (await this.tools.create_ai_session(options.boardId ? { boardId: options.boardId } : {}))
      .json<{ channelName: string }>();
    return new MirvaSession(this, channelName);
  }

  /** Ask Mirva for something in a new session and wait for the reply. */
  async ask(message: string, options: AskOptions & { boardId?: string } = {}): Promise<AskResult & { session: MirvaSession }> {
    const { boardId, ...askOptions } = options;
    const session = await this.session({ boardId });
    return { ...(await session.ask(message, askOptions)), session };
  }

  close(): void {
    this.client.close();
  }
}
