// packages/providers/types.ts — canonical provider adapter interface.
// Every provider (MiniMax, Ollama, future) must implement this shape.
// All calls go through /api. The browser never calls providers directly.

export interface ChatMessage {
  role:    'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages:     ChatMessage[];
  model:        string;
  temperature?: number;
  topP?:        number;
  maxTokens?:   number;
  stream?:      boolean;
}

export interface ChatChunk {
  type:    'delta' | 'done' | 'error';
  delta?:  string;
  usage?:  { promptTokens: number; completionTokens: number };
  error?:  string;
}

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
}
