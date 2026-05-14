# Contributing

Thank you for considering a contribution. Issues, bug reports, and PRs are all welcome.

## Reporting bugs

Open an [issue](https://github.com/david46liu/obsidian-knowledge-ai/issues) with:

- Obsidian version and OS.
- Plugin version (`manifest.json` → `version`).
- A minimal reproduction: a tiny vault folder (or describe the file types involved) and the steps.
- Console logs from `Ctrl/Cmd+Shift+I` → Console — filter on `[NotebookAI]` to find plugin-emitted entries.
- Whether vector retrieval is on, which provider/model is assigned to each task.

For indexing or extraction bugs, please attach a sample file (sanitized) if you can. PDF / DOCX edge cases are common and we can usually only reproduce with the actual file.

## Development setup

Requirements: Node 20+, an Obsidian vault to point your dev build at.

```bash
git clone https://github.com/david46liu/obsidian-knowledge-ai
cd obsidian-knowledge-ai
npm install
npm run dev
```

To install the dev build into a vault:

```bash
node scripts/deploy.mjs <path-to-vault>
```

`scripts/deploy.mjs` copies `main.js`, `manifest.json`, `styles.css`, both extractor/embedding workers, and the two `ort-wasm*.wasm` files into `<vault>/.obsidian/plugins/notebook-ai/`. After running it, reload Obsidian and the plugin picks up the changes.

## Project layout

```
src/
  main.ts                 Plugin entry: wires services, registers UI, builds workers.
  chunking/               Token-aware chunker (overlap, heading paths).
  extraction/             Per-format extractors (md, pdf, docx, xlsx, pptx, image).
    *.worker.ts           Real implementations run in Web Workers.
    pdf/stub.ts           Main-thread stub (importing pdfjs-dist on main causes conflict).
  indexer/                Scan/diff pipeline, hashCache, pathMap, scope matching.
  retrieval/              BM25, vector search, hybrid merge, llm reranker.
  providers/              OpenAI-compatible client, registry, task resolver.
  services/               NotebookService, IndexService, SearchService, ChatService,
                          GenerationService, SummaryService, ArtifactStore, etc.
  generation/             Per-artifact-kind generators (summary, timeline, mind-map…).
  ui/                     React components, views, hooks.
  i18n/                   Locale dictionary and t().
  types/                  Shared type defs.
```

Tests live in `src/**/__tests__/*.test.ts`. The plugin uses Vitest with happy-dom; no real Obsidian instance is required for unit tests.

## Coding conventions

- **TypeScript strict mode**; no `any` without a justifying comment.
- **No external state mutation** in plain functions — services own state, components observe.
- **Errors at boundaries**: throw inside services; UI converts to user-facing messages. Don't swallow errors silently.
- **No emoji in committed code or comments** (use plain text); the UI itself can use Unicode glyphs where it adds value.
- **Comments explain WHY, not WHAT** — a comment that paraphrases the line below it is noise.

## Internationalization

All user-visible strings go through `t('key')` and live in `src/i18n/locales/<lang>.ts`. When adding a new string:

1. Add the key to `src/i18n/locales/en.ts` (the default).
2. Add a translation to `src/i18n/locales/zh-CN.ts`. If you don't speak Chinese, leave the English string and add `// TODO: translate`.
3. Reference it via `t('your.key')` in your component.

PRs that hardcode strings will be asked to extract them.

## Pull requests

- Fork the repo and create a feature branch (`git checkout -b feat/some-thing`).
- Run `npm test`, `npm run type-check`, and `npm run lint` locally before pushing.
- Reference any related issue in the PR description.
- Small, focused PRs are reviewed faster than sprawling ones.
- Squash-merge is the default; commit-message hygiene during development isn't critical, but the final PR title becomes the merged commit.

## License

By contributing, you agree that your contributions will be licensed under the MIT License of this project.
