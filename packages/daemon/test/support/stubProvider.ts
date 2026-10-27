/**
 * PAW Daemon Test Stub Provider
 *
 * @fileoverview OpenAI chat-completions stand-in for live runtime tests, on
 * loopback. Answers every request with the turn a script returns and records
 * each request. JSON replies only: a `stream: true` or non-JSON request gets a
 * 400 naming the refusal.
 *
 * @module @paw/daemon/test/support/stubProvider
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/**
 * Chat-completions request body fields the stub reads.
 *
 * @interface StubChatBody
 * @property {Array<{ role: string; content?: unknown }>} [messages] - Conversation so far.
 * @property {Array<{ function?: { name?: string } }>} [tools] - Tools the runtime offers the model.
 * @property {number} [max_tokens] - Output ceiling the caller stamped.
 * @property {boolean} [stream] - Whether the runtime asked for server-sent events.
 */
export interface StubChatBody {
  readonly messages?: ReadonlyArray<{ readonly role: string; readonly content?: unknown }>;
  readonly tools?: ReadonlyArray<{ readonly function?: { readonly name?: string } }>;
  readonly max_tokens?: number;
  readonly stream?: boolean;
}

/**
 * One request the stub received.
 *
 * @interface StubRequest
 * @property {string} path - Request path, e.g. `/v1/chat/completions`.
 * @property {string | null} authorization - `Authorization` header, or null when absent.
 * @property {string} raw - Body as received.
 * @property {StubChatBody} body - Parsed body.
 * @property {string} prompt - Text of every user message, newline-joined.
 * @property {readonly string[]} offeredTools - Names of the tools offered to the model.
 * @property {readonly string[]} toolResults - Text of every tool-result message, in order.
 */
export interface StubRequest {
  readonly path: string;
  readonly authorization: string | null;
  readonly raw: string;
  readonly body: StubChatBody;
  readonly prompt: string;
  readonly offeredTools: readonly string[];
  readonly toolResults: readonly string[];
}

/**
 * Assistant turn the stub answers with.
 */
export type StubTurn =
  | { readonly kind: 'tool'; readonly name: string; readonly args: unknown }
  | { readonly kind: 'text'; readonly content: string };

/**
 * Options for {@link startStubProvider}.
 *
 * @interface StubProviderOptions
 * @property {{ promptTokens: number; completionTokens: number }} [usage] - Usage every reply reports; default 1 and 1.
 */
export interface StubProviderOptions {
  readonly usage?: { readonly promptTokens: number; readonly completionTokens: number };
}

/**
 * Running stub provider.
 *
 * @interface StubProvider
 * @property {string} baseUrl - Provider base URL, `http://127.0.0.1:<port>/v1`.
 * @property {readonly StubRequest[]} requests - Every request so far, in arrival order.
 * @property {() => Promise<void>} close - Stop listening.
 */
export interface StubProvider {
  readonly baseUrl: string;
  readonly requests: readonly StubRequest[];
  close(): Promise<void>;
}

/**
 * Turn that calls one tool.
 *
 * @param {string} name - Tool name.
 * @param {unknown} args - Tool arguments, serialised to JSON.
 * @returns {StubTurn} The tool-call turn.
 */
export function toolCall(name: string, args: unknown): StubTurn {
  return { kind: 'tool', name, args };
}

/**
 * Turn that ends the reply with text.
 *
 * @param {string} content - Assistant text.
 * @returns {StubTurn} The text turn.
 */
export function text(content: string): StubTurn {
  return { kind: 'text', content };
}

/**
 * Text of one message content: a string, or the `text` parts of a part array.
 *
 * @param {unknown} content - Message content.
 * @returns {string} The text; empty for any other shape.
 */
function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
  }
  return '';
}

/**
 * Record one parsed request.
 *
 * @param {IncomingMessage} req - Incoming request.
 * @param {string} raw - Body as received.
 * @param {StubChatBody} body - Parsed body.
 * @returns {StubRequest} The record.
 */
function recordOf(req: IncomingMessage, raw: string, body: StubChatBody): StubRequest {
  const messages = body.messages ?? [];
  return {
    path: req.url ?? '',
    authorization: req.headers.authorization ?? null,
    raw,
    body,
    prompt: messages.filter((m) => m.role === 'user').map((m) => textOf(m.content)).join('\n'),
    offeredTools: (body.tools ?? []).map((tool) => tool.function?.name ?? ''),
    toolResults: messages.filter((m) => m.role === 'tool').map((m) => textOf(m.content)),
  };
}

/**
 * Chat-completion response body for one turn.
 *
 * @param {StubTurn} turn - Turn to answer with.
 * @param {number} id - Request ordinal, used for the tool-call id.
 * @param {{ promptTokens: number; completionTokens: number }} usage - Reported usage.
 * @returns {Record<string, unknown>} The response body.
 */
function completionOf(
  turn: StubTurn,
  id: number,
  usage: { readonly promptTokens: number; readonly completionTokens: number },
): Record<string, unknown> {
  const message =
    turn.kind === 'tool'
      ? {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: `call_${id}`, type: 'function', function: { name: turn.name, arguments: JSON.stringify(turn.args) } }],
        }
      : { role: 'assistant', content: turn.content };
  return {
    id: `chatcmpl-stub-${id}`,
    object: 'chat.completion',
    created: 1,
    model: 'stub-model',
    choices: [{ index: 0, finish_reason: turn.kind === 'tool' ? 'tool_calls' : 'stop', message }],
    usage: {
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.promptTokens + usage.completionTokens,
    },
  };
}

/**
 * Send a 400 naming why the stub refused.
 *
 * @param {ServerResponse} res - Response to write.
 * @param {string} reason - Refusal text.
 * @returns {void}
 */
function refuse(res: ServerResponse, reason: string): void {
  res.writeHead(400, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: `stub provider: ${reason}` } }));
}

/**
 * Start a stub provider on an ephemeral loopback port.
 *
 * @param {(request: StubRequest) => StubTurn} script - Chooses the turn for each request.
 * @param {StubProviderOptions} [options] - Reported usage.
 * @returns {Promise<StubProvider>} The listening provider.
 */
export async function startStubProvider(
  script: (request: StubRequest) => StubTurn,
  options: StubProviderOptions = {},
): Promise<StubProvider> {
  const usage = options.usage ?? { promptTokens: 1, completionTokens: 1 };
  const requests: StubRequest[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      let body: StubChatBody;
      try {
        body = JSON.parse(raw) as StubChatBody;
      } catch (err: unknown) {
        refuse(res, `request body is not JSON: ${String(err)}`);
        return;
      }
      const record = recordOf(req, raw, body);
      requests.push(record);
      if (body.stream === true) {
        refuse(res, 'answers JSON only; the request asked for stream: true');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(completionOf(script(record), requests.length, usage)));
    });
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
  });
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
