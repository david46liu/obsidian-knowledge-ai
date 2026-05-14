# Changelog

All notable changes to this project will be documented in this file. Format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-05-11

新增 PDF 索引格式。

### Added

- **PDF 文档索引 (.pdf)** — 新增 `pdfExtractor`,基于 `pdfjs-dist` v5,在
  已有 extractor worker 内懒加载运行。每页生成 `## Page N` markdown 段落,
  `locatorMap` 按页记录 `{ kind: 'page', pageRange: [N, N] }` — 供 citation
  定位使用。空页(扫描/图片 PDF)自动跳过,损坏文件进 persistentFileErrors。
- Settings 的"索引格式"选项新增 PDF 勾选框。
- 文件右键菜单"在 Notebook AI 查看 chunks"及"重新提取此文件"支持 `.pdf` 文件。

## [0.2.0] — 2026-05-11

修复 chat 被坏文件卡死的阻塞问题 + 升级 chat 回复渲染。

### Fixed

- **chat 抛 "error rate 3/12 exceeded 0.2" 整库索引阻断** — `runPipeline` 在
  deterministic 解析错误率超过 20% 时 abort,导致少数坏 office 文件让整个
  notebook 索引失败、chat 无法 retrieve 任何 chunks。改动:
  - 阈值 `PIPELINE_ERROR_THRESHOLD` 0.2 → 0.5
  - 加 `PIPELINE_MIN_SAMPLES_FOR_THRESHOLD = 5`:批次 done 数 < 5 永不评估,
    避免少样本下个别坏文件被误判为系统性故障
  - producer `kind: 'error'` 不再 `throw`,改为记 hashCache.error +
    `recordPersistentError` 后 `return`,pipeline 跑完所有文件,阈值守门仅
    作为真·系统性故障兜底

### Added

- **`NotebookCard` 显示 PersistentErrorBar** — 类似 TransientErrorBar 但颜色
  橙色、无"重试"按钮(deterministic 错误重试无效),可展开查看具体文件路径
  + 错误信息。新类型 `NotebookPersistentFileError`,FIFO 保留最近 20 条。
- **chat 回复用 Obsidian MarkdownRenderer 渲染** — `ChatMessage` 之前用
  `whiteSpace: pre-wrap` 直接显示 LLM 返回的 markdown 源码,标题/表格/列表/
  粗体/代码全部按字符显示。改用内置 `MarkdownRenderer.render`,主题一致免
  新依赖。citation `[N]` 处理:render 前替换为占位符避免被 markdown 解析,
  render 后 DOM walker 替换为可点击 `<a>` 元素调 `openVaultFile`。

### Changed

- `PluginServices` 加 `app: App` 字段(供需要 Obsidian API 的 UI 用)。

## [0.1.0] — 2026-05-11

首个功能完整的版本 — 基础索引管线 + Office 文件解析 + UI 集成全部就位。

### Added

- **Indexing foundation (Plan A)** — scan / diff / pipeline / BM25,基于 hash
  + 复合 `parserVersion`(`PARSER_VERSION` + extractor.version + 配置项 FNV-1a)
  缓存解析结果;`STALE_PARSER` 分类与 transient 错误 sink。
- **Office file extractors (Plan B)** — `.docx`(mammoth)、`.xlsx`(SheetJS)、
  `.pptx`(`@xmldom/xmldom` + fflate) extractor,均跑在独立 Web Worker
  内,主线程不阻塞。LaneScheduler 快/慢车道按文件大小分流。
  `WorkerHostError` 把 parse / timeout / worker-crash 分类后由 pipeline 决定
  是否进 transientFileErrors。
- **Notebook UI 集成 (Plan C)** — Settings 表单的"索引格式"
  (`OfficeFormatPicker`)+ "Office 解析选项"(`OfficeOptionsPanel`);
  `NotebookCard` 顶部 `TransientErrorBar` 列 transient 失败 + "重试"按钮;
  文件夹右键 3 项菜单(`folderContextMenu`,含子菜单);文件右键的
  "在 Notebook AI 查看 chunks"(`ChunksInspectorModal`)与"重新提取此文件"
  (`fileContextMenu`);`NotebookFromFolderModal` 快速从文件夹建 notebook;
  Ribbon 左键打开主视图、右键弹切换/重新索引/设置菜单
  (`ribbonContextMenu`)。
- 命令 `Reindex all notebooks`(fire-and-forget 并发触发全库重索引)。
- 类型:`Locator`、`NotebookOfficeOptions`、`Notebook.fileExtensions`、
  `Chunk.locator`。

### Changed

- `PluginServices` 接口扩展 3 个方法:`fetchChunksForFile`、
  `invalidateFileHash`、`openChunksInspector`。
- `Notebook` 老字段(无 `fileExtensions` / `officeOptions` /
  `transientFileErrors`)在 UI 与 service 层均有 `?? ['md']` / `?? {}` /
  可选链兜底,加载/编辑/保存均向后兼容。
- `ChunkProduct` 增加 `transient` 变体;`ScannedFile.contentBytes` 取代
  `content`;`HashContentFn` 改为接收字节。

### Fixed

- LaneScheduler 直接交接(direct-handoff)模式 — 修复并发释放时
  `current` 可能超 capacity 的竞态。
- `ExtractorRegistry.get` 并发安全 — 共享 in-flight Promise,首次加载
  并发不会重复实例化。
- Worker Blob URL 在 `onunload` 中 `URL.revokeObjectURL` — 卸载插件时无
  内存泄漏。
- 启动时预热所有 office extractors,避免 `ensureBM25ForNotebook` 在首次
  注册前调用 `syncGet('docx')` 拿到 undefined 而静默丢 chunks。
- `folderContextMenu` 的"添加为 Notebook 源"补 `crypto.randomUUID()`,
  避免 `services.updateNotebook` patch 风格不为新 source 补 UUID。
- `notebookCoversFile` 与 `fileContextMenu` owners 过滤跳过 `enabled === false`
  的 source,与 `scope.ts:matchesSource` 行为对齐。
