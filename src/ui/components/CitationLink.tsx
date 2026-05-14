import React from 'react';
import type { Citation } from 'src/types/chat';
import { usePluginServices } from 'src/ui/hooks/useStore';

interface Props {
  citation: Citation;
}

export function CitationLink({ citation }: Props) {
  const services = usePluginServices();
  // TODO(i18n): wire up t()
  const tooltip = `${citation.headingPath.join(' > ') || '(untitled)'} — ${citation.filePath}\n\n${citation.preview}`;
  return (
    <a
      href="#"
      title={tooltip}
      onClick={e => {
        e.preventDefault();
        services.openVaultFile(citation.filePath, citation.charStart);
      }}
      style={{ color: 'var(--interactive-accent)', textDecoration: 'none', padding: '0 2px' }}
    >
      [{citation.index}]
    </a>
  );
}
