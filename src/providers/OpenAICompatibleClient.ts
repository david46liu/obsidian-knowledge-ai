import type { LLMClient, ChatOptions, ProviderCapabilities, TokenUsage, StreamEvent } from './types';
import { parseSSEStream } from './sseParser';

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
}

export class OpenAICompatibleClient implements LLMClient {
  readonly capabilities: ProviderCapabilities;
  private readonly config: ProviderConfig;

  constructor(config: ProviderConfig, capabilities: ProviderCapabilities) {
    this.config = config;
    this.capabilities = capabilities;
  }

  async chat(opts: ChatOptions): Promise<{ content: string; usage?: TokenUsage }> {
    const body = this.buildBody(opts);
    const res = await this.doFetch('/chat/completions', body, opts.signal);
    const json = await res.json() as {
      choices: Array<{ message?: { content?: string; reasoning_content?: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    if (!json.choices?.length) throw new Error('No choices in response');
    // Reasoning model fallback: 部分 thinking 模型(kimi-k2.6 / deepseek-r1 等)
    // 把最终答案放在 message.reasoning_content 而非 message.content。优先 content,
    // 空时回退到 reasoning_content 以避免静默空响应。
    const msg = json.choices[0]?.message;
    const content = (msg?.content && msg.content.length > 0)
      ? msg.content
      : (msg?.reasoning_content ?? '');
    const usage: TokenUsage | undefined = json.usage
      ? {
          promptTokens: json.usage.prompt_tokens,
          completionTokens: json.usage.completion_tokens,
          totalTokens: json.usage.total_tokens,
        }
      : undefined;
    return { content, usage };
  }

  async *chatStream(opts: ChatOptions): AsyncIterable<StreamEvent> {
    if (!this.capabilities.supportsStreaming) throw new Error('Provider does not support streaming');
    const body = { ...this.buildBody(opts), stream: true };
    // 流式调用不设整体 timeout: reasoning model(K2.6 / R1 / o1)思考阶段
    // 静默 30s+ 是常态;依赖 caller 的 AbortController 主动取消即可
    const res = await this.doFetch('/chat/completions', body, opts.signal, true);
    if (!res.body) throw new Error('No response body for stream');
    yield* parseSSEStream(res.body);
  }

  private buildBody(opts: ChatOptions): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages,
    };
    if (opts.temperature !== undefined && this.capabilities.supportsTemperature) {
      body.temperature = opts.temperature;
    }
    if (opts.maxTokens !== undefined && this.capabilities.supportsMaxTokens) {
      body[this.capabilities.maxTokensFieldName] = opts.maxTokens;
    }
    if (opts.responseFormat === 'json_object' && this.capabilities.supportsJsonMode) {
      body.response_format = { type: 'json_object' };
    }
    return body;
  }

  private async doFetch(
    endpoint: string,
    body: unknown,
    signal?: AbortSignal,
    skipTimeout = false
  ): Promise<Response> {
    const url = `${this.config.baseUrl}${endpoint}`;
    const timeoutSignal = !skipTimeout && this.config.timeoutMs !== undefined
      ? AbortSignal.timeout(this.config.timeoutMs)
      : undefined;
    const combinedSignal = signal && timeoutSignal
      ? AbortSignal.any([signal, timeoutSignal])
      : signal ?? timeoutSignal;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
        ...this.config.defaultHeaders,
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
    }
    return res;
  }
}
