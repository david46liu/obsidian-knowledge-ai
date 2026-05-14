// src/ui/modals/NotebookFromFolderModal.tsx
import { App, Modal, Notice } from 'obsidian';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PluginServices } from 'src/ui/hooks/useStore';
import { ALL_FORMATS, FORMAT_LABELS } from 'src/ui/components/OfficeFormatPicker';

export class NotebookFromFolderModal extends Modal {
  private root: Root | null = null;

  constructor(
    app: App,
    private readonly folderPath: string,
    private readonly services: PluginServices,
  ) {
    super(app);
  }

  onOpen(): void {
    const folderName = this.folderPath.split('/').filter(Boolean).pop() ?? this.folderPath;
    // TODO(i18n): wire up t()
    this.titleEl.setText(`New Notebook · ${this.folderPath}`);
    this.root = createRoot(this.contentEl);
    this.root.render(
      <NotebookFromFolderForm
        folderPath={this.folderPath}
        defaultName={folderName}
        services={this.services}
        onDone={() => this.close()}
      />
    );
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}

interface FormProps {
  folderPath: string;
  defaultName: string;
  services: PluginServices;
  onDone(): void;
}

function NotebookFromFolderForm({ folderPath, defaultName, services, onDone }: FormProps) {
  const [name, setName] = React.useState(defaultName);
  const [recursive, setRecursive] = React.useState(true);
  const [exts, setExts] = React.useState<string[]>([...ALL_FORMATS]);
  const [submitting, setSubmitting] = React.useState(false);

  const submit = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      // C4: addNotebook returns Promise<Notebook>
      const nb = await services.addNotebook(name.trim(), {
        id: '',
        type: 'folder',
        path: folderPath,
        recursive,
        enabled: true,   // I2: spec §8.1 要求 enabled:true
      });
      await services.updateNotebook(nb.id, { fileExtensions: exts });
      // TODO(i18n): wire up t()
      new Notice(`Created Notebook "${name}"`);
      onDone();
    } catch (e) {
      // TODO(i18n): wire up t()
      new Notice(`Create failed: ${e instanceof Error ? e.message : String(e)}`);
      setSubmitting(false);
    }
  };

  const toggleExt = (ext: string) => {
    if (ext === 'md') return;
    setExts(prev => prev.includes(ext)
      ? prev.filter(e => e !== ext)
      : ALL_FORMATS.filter(e => prev.includes(e) || e === ext)
    );
  };

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ marginBottom: '12px' }}>
        {/* TODO(i18n): wire up t() */}
        <label>Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          style={{ width: '100%', marginTop: '4px' }}
        />
      </div>
      <div style={{ marginBottom: '12px' }}>
        {/* TODO(i18n): wire up t() */}
        <label>
          <input type="checkbox" checked={recursive} onChange={e => setRecursive(e.target.checked)} />
          {' '}Include subfolders
        </label>
      </div>
      <div style={{ marginBottom: '12px' }}>
        {/* TODO(i18n): wire up t() */}
        <label>Indexed formats</label>
        <div style={{ marginTop: '4px' }}>
          {ALL_FORMATS.map(ext => (
            <label key={ext} style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={exts.includes(ext)}
                disabled={ext === 'md'}
                onChange={() => toggleExt(ext)}
              />
              {' '}{FORMAT_LABELS[ext]}
            </label>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        {/* TODO(i18n): wire up t() */}
        <button onClick={onDone} disabled={submitting}>Cancel</button>
        {/* TODO(i18n): wire up t() */}
        <button onClick={submit} disabled={!name.trim() || submitting}>
          {submitting ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  );
}
