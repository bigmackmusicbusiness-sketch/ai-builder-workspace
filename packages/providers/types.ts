// packages/providers/types.ts — canonical provider adapter interface.
// Every provider (MiniMax, Ollama, future) must implement this shape.
// All calls go through /api. The browser never calls providers directly.

/** A single content block in a multipart (vision-capable) message. */
export type ContentPart =
  | { type: 'text';      text:      string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role:    'system' | 'user' | 'assistant' | 'tool';
  /** String for text-only messages; ContentPart[] when images are attached.
   *  null is allowed on assistant messages that carry tool_calls with no text
   *  (MiniMax rejects empty-string content in that case — use null instead). */
  content: string | ContentPart[] | null;
  /** Only set on role='tool' — echoes the tool_call.id this result belongs to. */
  tool_call_id?: string;
  /** Only set on role='assistant' when the model invokes tools. */
  tool_calls?: ToolCall[];
  /** Optional name — used on role='tool' to identify which tool ran. */
  name?: string;
}

/** OpenAI-compatible JSON-schema tool definition. */
export interface ToolDefinition {
  type: 'function';
  function: {
    name:        string;
    description: string;
    parameters:  Record<string, unknown>; // JSON Schema
  };
}

/** A single tool invocation emitted by the model. */
export interface ToolCall {
  id:   string;
  type: 'function';
  function: {
    name:      string;
    /** JSON-encoded arguments (string, as per OpenAI spec). */
    arguments: string;
  };
}

export interface ChatRequest {
  messages:     ChatMessage[];
  model:        string;
  temperature?: number;
  topP?:        number;
  maxTokens?:   number;
  stream?:      boolean;
  /** Tool definitions the model may call. */
  tools?:       ToolDefinition[];
  /** Controls how the model uses tools. 'auto' = model decides. */
  toolChoice?:  'auto' | 'none' | 'required';
}

export type ChatChunk =
  | { type: 'delta';     delta: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'done';      usage?: { promptTokens: number; completionTokens: number } }
  | { type: 'error';     error: string };

export interface CompleteRequest {
  prompt:       string;
  model:        string;
  maxTokens?:   number;
  temperature?: number;
}

export interface CompleteResponse {
  text:         string;
  model:        string;
  usage:        { promptTokens: number; completionTokens: number };
  latencyMs:    number;
}

export interface EmbedRequest {
  texts: string[];
  model: string;
}

export interface EmbedResponse {
  embeddings: number[][];
  model:      string;
}

export interface HealthcheckResult {
  ok:        boolean;
  latencyMs: number;
  detail?:   string;
}

export interface ModelInfo {
  id:      string;
  label:   string;
  /** Size in billions of parameters, if known */
  sizeB?:  number;
}

export interface ImageGenRequest {
  prompt: string;
  /** Square pixel size, e.g. "1024x1024". Default: "1024x1024". */
  size?: string;
  signal?: AbortSignal;
}

export interface ImageGenResponse {
  /** Raw image bytes ready to write to disk. */
  buffer: Buffer;
  /** File extension without leading dot, e.g. "jpg" or "png". */
  ext: string;
}

/** The contract every provider adapter must satisfy. */
export interface ProviderAdapter {
  readonly id: string;
  readonly label: string;

  /** List available models for this provider. */
  listModels(): Promise<ModelInfo[]>;

  /** Check connectivity and key validity. */
  healthcheck(): Promise<HealthcheckResult>;

  /** Streaming chat. Yields ChatChunks until a 'done' chunk. */
  chat(req: ChatRequest, opts: { signal: AbortSignal }): AsyncIterable<ChatChunk>;

  /** Non-streaming single completion. */
  complete(req: CompleteRequest): Promise<CompleteResponse>;

  /** Optional embedding. */
  embed?(req: EmbedRequest): Promise<EmbedResponse>;

  /** Optional image generation — returns raw image bytes + file extension. */
  generateImage?(req: ImageGenRequest): Promise<ImageGenResponse>;
}
