import type { Extractor } from './types';

export const markdownExtractor: Extractor = {
  extensions: ['md', 'txt'] as const,
  version: 1,
  async extract(bytes, _opts?) {
    const markdown = new TextDecoder('utf-8').decode(bytes);
    return { markdown, locatorMap: [] };
  },
};
