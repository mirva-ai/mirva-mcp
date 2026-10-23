import { isImageResult, isTextResult } from './client.ts';

/** An image a tool returned. */
export interface ToolImage {
  mimeType: string;
  data: Buffer;
}

/**
 * What a tool answered, in one shape whatever form the server sent it in: its text parts joined, its images decoded.
 * Most tools answer with JSON text; `json()` parses it. The server does not declare answer shapes, so the type
 * parameter is the caller's own description of what the tool returns.
 */
export class ToolOutput {
  /** The result as the server sent it. */
  readonly raw: unknown;
  readonly text: string;
  readonly images: ToolImage[];

  constructor(raw: unknown) {
    this.raw = raw;
    const texts: string[] = [];
    const images: ToolImage[] = [];
    for (const part of parts(raw)) {
      if (isImageResult(part)) images.push({ mimeType: part.mimeType ?? 'image/png', data: Buffer.from(part.data, 'base64') });
      else if (isTextResult(part)) texts.push(part.text);
      else if (typeof part === 'string') texts.push(part);
      else if (part != null) texts.push(JSON.stringify(part));
    }
    this.text = texts.join('\n');
    this.images = images;
  }

  /** The text parsed as JSON. Throws when the tool answered with prose. */
  json<T = unknown>(): T {
    return JSON.parse(this.text) as T;
  }

  /** The first image, or undefined when the tool returned none. */
  get image(): ToolImage | undefined {
    return this.images[0];
  }
}

/** The parts of a result: an MCP-style `{ content: [...] }`, an array of parts, or a single one. */
function parts(raw: unknown): unknown[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && Array.isArray((raw as { content?: unknown }).content)) return (raw as { content: unknown[] }).content;
  return [raw];
}
