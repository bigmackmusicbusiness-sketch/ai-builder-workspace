// packages/providers/index.ts — provider adapter types (shared by web + api).
// Adapter implementations live in apps/api/src/providers/ (server-side only).
export type {
  ContentPart,
  ChatMessage, ChatRequest, ChatChunk,
  CompleteRequest, CompleteResponse,
  EmbedRequest, EmbedResponse,
  ImageGenRequest, ImageGenResponse,
  HealthcheckResult, ModelInfo,
  ProviderAdapter,
  ToolDefinition, ToolCall,
} from './types';
