import React, { useState } from 'react';
import { t } from 'src/i18n';
import type { Provider, ProviderId } from 'src/types/data';

interface ProviderCardProps {
  provider: Provider;
  onEdit(p: Provider): void;
  onDelete(id: ProviderId): void;
  onTestConnection(id: ProviderId): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
}

type TestState = 'idle' | 'loading' | 'ok' | 'error';

export function ProviderCard({ provider, onEdit, onDelete, onTestConnection }: ProviderCardProps) {
  const [testState, setTestState] = useState<TestState>('idle');
  const [testResult, setTestResult] = useState<{ latencyMs: number } | { error: string } | null>(null);

  const handleTest = async () => {
    setTestState('loading');
    setTestResult(null);
    const result = await onTestConnection(provider.id);
    if (result.ok) {
      setTestState('ok');
      setTestResult({ latencyMs: result.latencyMs });
    } else {
      setTestState('error');
      setTestResult({ error: result.error ?? t('common.unknown') });
    }
  };

  return (
    <div style={{ border: '1px solid var(--background-modifier-border)', padding: '8px', marginBottom: '8px', borderRadius: '4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong>{provider.displayName}</strong>
          {provider.disabled && <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>{t('providerCard.disabledTag')}</span>}
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85em' }}>{provider.baseUrl}</div>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button onClick={handleTest} disabled={testState === 'loading'}>
            {testState === 'loading' ? t('providerCard.testing') : t('providerCard.test')}
          </button>
          <button onClick={() => onEdit(provider)}>{t('common.edit')}</button>
          <button onClick={() => { if (window.confirm(t('providerCard.deleteConfirm', { name: provider.displayName }))) onDelete(provider.id); }}>
            {t('common.delete')}
          </button>
        </div>
      </div>
      {testState === 'ok' && testResult && 'latencyMs' in testResult && (
        <div style={{ color: 'var(--color-green)', marginTop: '4px' }}>
          ✓ {testResult.latencyMs}ms
        </div>
      )}
      {testState === 'error' && testResult && 'error' in testResult && (
        <div style={{ color: 'var(--color-red)', marginTop: '4px' }}>
          ✗ {testResult.error}
        </div>
      )}
    </div>
  );
}
