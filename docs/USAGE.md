# Knowledge AI — Usage guide

[简体中文](./USAGE.zh-CN.md) · English

This guide covers everything beyond the quick-start in the [README](../README.md): per-feature settings, what to do when something feels slow, and how the retrieval pipeline actually picks chunks.

## Notebooks

A **notebook** is a scoped view over your vault — a set of folders (with optional include/exclude globs) plus a system prompt. All chat and artifact generation happens against the active notebook.

- **Create**: Settings → Notebooks → Add, or right-click a folder in the file explorer → "Create Notebook from this folder".
- **Multi-folder notebook**: edit a notebook and add additional sources; each source has its own `enabled` toggle so you can temporarily exclude a folder without losing the config.
- **File-type filter**: by default a notebook indexes `.md`. Tick the additional formats you want under "Index formats" — PDF, DOCX, XLSX, PPTX.
- **System prompt**: lives on the notebook, not the provider. Use it to set the assistant's persona / response constraints for everything you ask in this notebook.

## Indexing

When you open or create a notebook, the indexer runs scan → diff → extract → chunk → persist. You'll see a progress bar on the notebook card.

- **Status badges** on the notebook card: `idle` (✓), `dirty` (●), `indexing` (⟳), `error` (✗). Dirty means a vault file changed and the notebook needs a rebuild — the next chat triggers it automatically.
- **Persistent errors** (orange bar): deterministic parse failures that won't recover on retry (encrypted PDFs, malformed DOCX). Expand the bar to see the file list.
- **Transient errors** (yellow bar): timeouts, worker crashes, etc. Click "Retry" to re-attempt.
- **Re-extract one file**: right-click the file in the explorer → "Re-extract for Knowledge AI".
- **Inspect chunks**: right-click a file → "View chunks in Knowledge AI" to see exactly what the LLM sees.

## Retrieval

There are three retrieval signals; they're merged with Reciprocal Rank Fusion (RRF):

1. **BM25** (always on) — keyword match over the chunk text. CJK falls back to character n-grams.
2. **Vector** (opt-in) — semantic similarity over chunk embeddings. Enable under Settings → Vector retrieval.
3. **Document-level summary** (auto for summary-style questions) — when your question contains keywords like "summarize", "overview", "highlights", the retriever first searches per-document summaries, then expands to chunks inside the top documents. Backfill summaries from the notebook card.

Chat-time options (top of the chat input):

- **Top K** — how many chunks the LLM sees. Default 15. Raise for "synthesis" questions, lower for focused look-ups.
- **Expand query** — rewrites your query into 2-3 paraphrases and merges results. Helps when your wording is far from the source vocabulary; costs one LLM call.
- **Expand neighbors** — for each retrieved chunk, also include the previous/next chunks from the same file. Useful for narrative content.
- **Summary mode** (`auto` / `on` / `off`) — controls whether to use the document-level summary route. Default `auto`.

## Vector retrieval

- **Local (recommended start)**: `Xenova/multilingual-e5-small` (default) — ~110 MB ONNX model, downloaded once on first use into `<plugin>/cache/transformers/`. Runs in a Web Worker with ONNX Runtime Web (WASM backend).
- **External API**: any OpenAI-compatible embedding endpoint. Note that many Chinese LLM providers (DeepSeek, Moonshot/Kimi) do not currently expose embedding endpoints — `supportsEmbeddings` defaults to false on those. Add a provider that has them (OpenAI, Zhipu GLM, Qwen, etc.) and tick the capability.
- **Coverage** is shown under "Vector retrieval" in settings. A "outdated" warning means you switched models since indexing; click "Full reindex" to recompute.
- **Cost**: vectors are persisted to disk so re-opening Obsidian doesn't recompute. Only changed files re-embed.

## Document summaries (Phase 2.7)

For libraries with > 1 000 documents, the retriever benefits massively from a per-document summary layer.

- **Backfill**: open the notebook card → click "Backfill summaries". A progress bar shows `done / total (in-flight N, failed N, skipped N no content)`.
- **Concurrency**: defaults to 1 (gentle on rate-limited Chinese providers). DeepSeek / OpenAI can handle 3-4.
- **Skipped** = documents with no extractable text (scanned PDFs, image-only DOCX). Won't be re-attempted unless you turn on OCR (see below) and re-index.
- **Failures**: most often 429/overloaded from the provider. The backfill retries with exponential backoff (1.5s, 3s, 6s, 12s + jitter) up to 4 times before counting as failed.
- **Provider stability**: DeepSeek and OpenAI are the most stable for long-running batch jobs. Moonshot/Kimi `engine_overloaded` during peak hours is common — let it retry, or run backfill off-peak.

## Image indexing (OCR + Vision)

Settings → Image indexing.

- **OCR** uses Tesseract.js. Default languages: `chi_sim` + `eng`. First run downloads ~25 MB of trained data per language into the plugin folder. Output is appended to the markdown chunk as plain text.
- **Vision** sends the image to an LLM with vision capability (you have to assign a `vision` task model). Useful for charts/diagrams where OCR isn't enough.
- **Max image size**: defaults to 5 MB. Larger images are skipped (they tend to OOM the WASM heap).

## Artifact generation

Open the chat view → "Artifacts" tab → pick a kind:

- **Summary** — single-pass synthesis.
- **Study guide** — exam-style Q&A pairs covering the material.
- **Timeline** — date-anchored bullet list.
- **FAQ** — likely-asked questions with grounded answers.
- **Briefing** — executive-summary style.
- **Mind map** — markdown indented list; rendered as a tree in the viewer.
- **Slide deck** — markdown-style slides; export to `.pptx` via `pptxgenjs`.

The "Materials truncated" badge means the notebook is too big to fit in one shot (default budget is 200K tokens of source material). The output itself is still complete, but documents past the budget weren't shown to the LLM. To get fuller coverage either: split into a tighter notebook, or assign a model with longer context.

## Saving chat answers as notes

Click the "Save as note" button under any cited assistant turn. A new `.md` is created in the active notebook's first folder, with the answer text, full citations, and the original question.

## Performance troubleshooting

- **Slow Obsidian startup with the plugin enabled** — the plugin defers heavy work (embedding worker init, folder events) to `onLayoutReady + 2s`. If you still see > 30 s startup, open DevTools → Console and search for `[NotebookAI perf]` — each stage is timed.
- **First indexing of a large vault is slow** — that's the parse step. The Web Worker pool can handle ~50 files/s for `.md`, ~5 files/s for `.pdf` (text layer) and `.docx`. Plan for ~20 minutes for a 5 000-file mixed vault.
- **Chat first-token latency** — most time is in the LLM. Retrieval itself is sub-second once BM25 is built. To shave latency, drop top-K, disable query expansion, or switch to a faster model for the `chat` task.

## Privacy

All data stays on disk (under `<vault>/.obsidian/plugins/notebook-ai/`) and travels only to the API endpoints you explicitly configure. No telemetry, no analytics.

If you want a fully offline setup, use local embeddings (default) and a self-hosted OpenAI-compatible endpoint (Ollama, LM Studio, vLLM) — the plugin doesn't know the difference.
