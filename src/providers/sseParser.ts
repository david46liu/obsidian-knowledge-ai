import type { StreamEvent, TokenUsage } from './types';

export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>
): AsyncIterable<StreamEvent> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const block of parts) {
        const event = parseBlock(block);
        if (event) yield event;
      }
    }
    // 处理最后可能的非空 buffer
    if (buffer.trim()) {
      const event = parseBlock(buffer);
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): StreamEvent | null {
  // Scan entire block before deciding what to emit; this ensures usage data
  // is not lost when [DONE] and usage appear in the same SSE block.
  let hasDone = false;
  let collectedUsage: TokenUsage | undefined;

  for (const line of block.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (raw === '[DONE]') { hasDone = true; continue; }
    try {
      const json = JSON.parse(raw) as {
        choices?: Array<{ delta?: { content?: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
      const content = json.choices?.[0]?.delta?.content;
      if (content !== undefined && content !== '') {
        return { type: 'delta', content };
      }
      if (json.usage) {
        const u = json.usage;
        collectedUsage = {
          promptTokens: u.prompt_tokens,
          completionTokens: u.completion_tokens,
          totalTokens: u.total_tokens,
        };
      }
    } catch {
      // 非 JSON 行跳过
    }
  }

  if (hasDone || collectedUsage) {
    return { type: 'done', usage: collectedUsage };
  }
  return null;
}
