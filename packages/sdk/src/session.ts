import type { Mirva } from './mirva.ts';
import type { ToolImage } from './output.ts';

/** A message in a chat channel, as get_messages reports it. */
export interface ChatMessage {
  _id: string;
  userId?: string;
  message: string;
  createdAt: string;
  /** The message this one answers: a Mirva reply names the request it ends. */
  replyTo?: string;
  files?: { fileId: string; name?: string; mimeType?: string; width?: number; height?: number }[];
  /** Images the agent generated during the turn; fetch one with `image(fileId)`. */
  producedImages?: { fileId: string; name?: string; width?: number; height?: number }[];
  /** The tools the agent ran, in order. */
  tools?: { tool: string; ok?: boolean; generated?: boolean }[];
  /** What the agent added to the board during the turn. */
  boardEdits?: unknown[];
  boardEditsUndone?: boolean;
}

/** An image to attach to a request: bytes, or base64 already. */
export interface AskImage {
  data: Buffer | string;
  name?: string;
  mimeType?: string;
}

export interface AskOptions {
  images?: AskImage[];
  /** Called with each message that arrives in the channel while the turn runs. */
  onMessage?: (message: ChatMessage) => void;
  /** How long to wait for the reply. Default 15 minutes. */
  timeoutMs?: number;
  /** How often to read the channel. Default 2 seconds. */
  pollMs?: number;
  signal?: AbortSignal;
}

export interface AskResult {
  /** The request as sent. */
  messageId: string;
  /** Mirva's reply, the message that ends the turn. */
  reply: ChatMessage;
  /** Every message after the request, the reply last. */
  messages: ChatMessage[];
}

const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_POLL_MS = 2_000;
/** The page read on each poll: enough for the messages of one turn */
const PAGE = 50;

/**
 * A conversation with Mirva: one AI session channel, scoped to a board when given one. Requests in the same session
 * see the earlier ones, as in the web app's chat.
 */
export class MirvaSession {
  readonly mirva: Mirva;
  readonly channelName: string;

  constructor(mirva: Mirva, channelName: string) {
    this.mirva = mirva;
    this.channelName = channelName;
  }

  /**
   * Ask Mirva for something and wait until it has answered. The turn may run tools, generate images and edit the
   * board, which takes minutes for a render; the reply carries what it did. A turn that Mirva stops or fails also
   * ends with a reply, saying so.
   */
  async ask(message: string, options: AskOptions = {}): Promise<AskResult> {
    const images = options.images?.map(image => ({
      data: typeof image.data === 'string' ? image.data : image.data.toString('base64'),
      ...(image.name ? { name: image.name } : {}),
      ...(image.mimeType ? { mimeType: image.mimeType } : {}),
    }));
    const sent = (await this.mirva.tools.send_message({
      channelName: this.channelName, message, ...(images?.length ? { images } : {}),
    })).json<{ messageId: string }>();
    return this.waitForReply(sent.messageId, options);
  }

  /** The channel's latest messages, oldest first. */
  async messages(limit = PAGE): Promise<ChatMessage[]> {
    return (await this.mirva.tools.get_messages({ channelName: this.channelName, limit })).json<ChatMessage[]>();
  }

  /** An image from a message: a file attached to it, or one the agent produced. */
  async image(fileId: string): Promise<ToolImage> {
    const output = await this.mirva.tools.read_message_image({ fileId });
    const image = output.image;
    if (!image) throw new Error(`read_message_image returned no image: ${output.text}`);
    return image;
  }

  private async waitForReply(messageId: string, options: AskOptions): Promise<AskResult> {
    const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    const seen = new Set<string>();
    const after: ChatMessage[] = [];
    let requester: string | undefined;

    for (;;) {
      options.signal?.throwIfAborted();
      const page = await this.messages();
      const index = page.findIndex(m => m._id === messageId);
      if (index >= 0) requester = page[index].userId;
      // until the request shows in the page every message in it predates the request
      for (const m of index >= 0 ? page.slice(index + 1) : []) {
        if (seen.has(m._id)) continue;
        seen.add(m._id);
        after.push(m);
        options.onMessage?.(m);
        if (endsTurn(m, messageId, requester)) return { messageId, reply: m, messages: after };
      }
      if (Date.now() >= deadline) throw new Error(`No reply to ${messageId} in ${this.channelName} within the timeout`);
      await sleep(pollMs, options.signal);
    }
  }
}

/**
 * Whether a message ends the turn a request started. A server that reports replyTo says so exactly; one that does
 * not is read the way the conversation reads: the first message after the request from someone else.
 */
function endsTurn(message: ChatMessage, requestId: string, requester: string | undefined): boolean {
  if (message.replyTo !== undefined) return message.replyTo === requestId;
  return requester !== undefined && message.userId !== undefined && message.userId !== requester;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
