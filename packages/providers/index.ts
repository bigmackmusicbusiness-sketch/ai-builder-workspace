// packages/providers/index.ts — provider adapter types (shared by web + api).
// Adapter implementations live in apps/api/src/providers/ (server-side only).
export type {
  ChatMessage, ChatRequest, ChatChunk,
  CompleteRequest, CompleteResponse,
  EmbedRequest, EmbedResponse,
  HealthcheckResult, ModelInfo,
  ProviderAdapter,
} from './types';
