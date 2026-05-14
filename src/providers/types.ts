// ProviderCapabilities 的权威定义在 src/types/data.ts
import type { ProviderCapabilities } from 'src/types/data';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type StreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'done'; usage?: TokenUsage }
  | { type: 'error'; error: Error };

export interface ChatOptions {
  messages: ChatMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json_object';
  signal?: AbortSignal;
}

export interface LLMClient {
  chat(opts: ChatOptions): Promise<{ content: string; usage?: TokenUsage }>;
  chatStream(opts: ChatOptions): AsyncIterable<StreamEvent>;
  readonly capabilities: ProviderCapabilities;
}

export type { ProviderCapabilities };
