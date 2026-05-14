import type { LLMClient } from 'src/providers/types';
import type { SamplingParams } from 'src/types/data';

export interface ResolvedTask {
  client: LLMClient;
  model: string;
  params: SamplingParams;
  providerOptions?: Record<string, unknown>;
}
