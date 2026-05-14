import type { Provider, TaskName, TaskAssignment, SamplingParams } from 'src/types/data';
import type { LLMClient } from 'src/providers/types';
import type { ResolvedTask } from './types';
import type { ProviderRegistry } from 'src/providers/registry';

export class TaskResolver {
  constructor(
    private readonly providers: Provider[],
    private readonly globalAssignments: Record<TaskName, TaskAssignment>,
    private readonly registry: ProviderRegistry
  ) {}

  resolve(
    task: TaskName,
    notebookOverrides?: Partial<Record<TaskName, TaskAssignment>>
  ): ResolvedTask | null {
    const assignment = notebookOverrides?.[task] ?? this.globalAssignments[task];
    if (!assignment) return null;
    if (assignment.enabled === false) return null;

    const provider = this.providers.find(p => p.id === assignment.providerId && !p.disabled);
    if (!provider) return null;

    const client: LLMClient = this.registry.getClient(provider);
    const caps = provider.capabilities;
    const s: SamplingParams = assignment.sampling ?? {};

    const params: ResolvedTask['params'] = {};
    if (s.temperature !== undefined && caps.supportsTemperature)   params.temperature = s.temperature;
    if (s.maxTokens !== undefined && caps.supportsMaxTokens)       params.maxTokens = s.maxTokens;
    // TODO(Phase 1): add supportsTopP / supportsPenalties to ProviderCapabilities and gate these
    if (s.topP !== undefined)                                       params.topP = s.topP;
    if (s.presencePenalty !== undefined)                            params.presencePenalty = s.presencePenalty;
    if (s.frequencyPenalty !== undefined)                           params.frequencyPenalty = s.frequencyPenalty;
    if (s.stopSequences !== undefined)                              params.stopSequences = s.stopSequences;

    return {
      client,
      model: assignment.model || provider.defaultModel,
      params,
      providerOptions: assignment.providerOptions,
    };
  }
}
