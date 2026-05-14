# Knowledge AI — 使用指南

简体中文 · [English](./USAGE.md)

本文档覆盖 [README](../README.zh-CN.md) 之外的深入内容:各功能设置、性能问题处理、检索管线的实际工作原理。

## Notebook

**notebook** 是 vault 的一个范围视图 —— 一组文件夹(可选 include/exclude glob)加一个 system prompt。chat 和产物生成都基于当前活跃的 notebook。

- **创建**:设置 → Notebooks → 添加,或在左侧文件浏览器右键文件夹 → "从此文件夹创建 Notebook"。
- **多文件夹 notebook**:编辑 notebook 加多个 source;每个 source 有自己的 enabled 开关,可临时排除某文件夹而不丢配置。
- **文件类型过滤**:默认只索引 `.md`。在"索引格式"勾选其他要的格式 —— PDF、DOCX、XLSX、PPTX。
- **System prompt**:挂在 notebook 上,不在 provider 上。用它设定助手在这个 notebook 里的人设/回答约束。

## 索引

打开或创建 notebook 时,索引器跑 scan → diff → extract → chunk → persist。notebook 卡片上有进度条。

- **状态标记**:`idle`(✓)、`dirty`(●)、`indexing`(⟳)、`error`(✗)。dirty 表示 vault 文件改了 notebook 需要重建 —— 下次 chat 自动触发。
- **持久错误**(橙色条):无法重试恢复的解析失败(加密 PDF、破损 DOCX 等)。展开看文件列表。
- **瞬时错误**(黄色条):超时、worker 崩溃等。点"重试"重新尝试。
- **重新提取单个文件**:文件浏览器右键 → "为 Knowledge AI 重新提取"。
- **查看 chunk**:文件右键 → "在 Knowledge AI 查看 chunks",看 LLM 实际看到的内容。

## 检索

三种检索信号,用 RRF(Reciprocal Rank Fusion)融合:

1. **BM25**(始终开启)—— chunk 文本关键词匹配。中文走字符 n-gram 回退。
2. **向量**(可选)—— chunk embedding 语义相似度。设置 → 向量检索 打开。
3. **文档级摘要**(自动用于摘要类问题)—— 问题含"总结"、"概览"、"亮点"等关键词时,先在文档摘要里检索,再下钻到候选文档的 chunk。在 notebook 卡片补齐摘要。

chat 时选项(输入框上方):

- **Top K** —— LLM 看到的 chunk 数量。默认 15。综合性问题调高,精准查找调低。
- **扩展查询** —— 把你的问题改写成 2-3 个同义表达后合并结果。措辞和原文相差大时有用;成本一次 LLM 调用。
- **扩展邻居** —— 每个命中 chunk 同时纳入同文件的前一段/后一段。叙事性内容有用。
- **摘要模式**(`auto` / `on` / `off`)—— 控制是否走文档级摘要路径。默认 `auto`。

## 向量检索

- **本地(推荐起步)**:`Xenova/multilingual-e5-small`(默认)—— ~110MB ONNX 模型,首次使用时下载到 `<plugin>/cache/transformers/`。在 Web Worker 内用 ONNX Runtime Web(WASM 后端)运行。
- **外部 API**:任何 OpenAI 兼容 embedding 端点。注意:多数国内 LLM provider(DeepSeek、Moonshot/Kimi)目前**不**提供 embedding 端点 —— 这些 provider 的 `supportsEmbeddings` 默认为 false。需要的话另外加一个提供 embedding 的 provider(OpenAI、智谱 GLM、Qwen 等),勾选 capability。
- **覆盖率** 在"向量检索"设置里显示。"outdated" 警告意味你换了模型,点"全量重新索引"重算。
- **成本**:向量持久化到磁盘,Obsidian 重启不重算;只有变更文件重新 embedding。

## 文档摘要(Phase 2.7)

> 1000 文档的库,检索质量极大受益于文档级摘要层。

- **补齐**:notebook 卡片 → 点"补齐摘要"。进度条显示 `done/total (in-flight N, 失败 N, 跳过 N 无内容)`。
- **并发**:默认 1(对国内 provider 友好,避免 429)。DeepSeek / OpenAI 可调到 3-4。
- **跳过** = 没有可提取文本的文档(扫描 PDF、纯图片 DOCX 等)。除非启用 OCR 重新索引,否则不会再次尝试。
- **失败**:多数是 provider 端 429/overloaded。补齐内置指数退避(1.5s、3s、6s、12s + 抖动)最多 4 次重试,超后才计失败。
- **provider 稳定性**:长时批量任务 DeepSeek 和 OpenAI 最稳。Moonshot/Kimi 在高峰期 `engine_overloaded` 常见 —— 让它重试,或避峰执行。

## 图片索引(OCR + Vision)

设置 → 图片索引。

- **OCR** 走 Tesseract.js。默认语言 `chi_sim` + `eng`。首次每语言下载 ~25MB 训练数据到插件文件夹。输出作为纯文本追加到 markdown chunk。
- **Vision** 把图片发给有视觉能力的 LLM(需在任务分配里给 `vision` 任务分配模型)。对图表/示意图比 OCR 更准。
- **图片大小上限**:默认 5MB。更大跳过(易把 WASM 堆撑爆)。

## 产物生成

打开 chat 视图 → "产物"标签 → 选类型:

- **摘要** —— 单次综合。
- **学习指南** —— 覆盖材料的考题问答对。
- **时间线** —— 按时间点的要点列表。
- **常见问答** —— 基于材料的可能问题及答案。
- **执行简报** —— 高管摘要风格。
- **思维导图** —— markdown 缩进列表;在 viewer 内渲染为树。
- **PPT 幻灯片** —— markdown 风格的幻灯;通过 `pptxgenjs` 导出 `.pptx`。

"资料截断"标记意味 notebook 太大一次喂不完(默认 20 万 token 资料预算)。输出本身完整,只是超过预算的文档没给 LLM 看。要更全的覆盖:把 notebook 范围缩窄,或换长上下文模型。

## chat 回答保存为笔记

任意带引用的 assistant 回答下方,点"保存为笔记"按钮。在当前 notebook 第一个文件夹生成新 `.md`,含回答文本、完整引用、原始问题。

## 性能问题

- **启用插件后 Obsidian 启动慢** —— 插件把重活(embedding worker 初始化、文件夹事件)推迟到 `onLayoutReady + 2s`。如果还超 30 秒,DevTools → Console 搜 `[NotebookAI perf]`,每个阶段都有计时。
- **大库首次索引慢** —— 解析阶段。Web Worker 池速度参考:`.md` ~50 文件/秒,`.pdf`(文本层)和 `.docx` ~5 文件/秒。5000 文件的混合 vault 计划 ~20 分钟。
- **chat 首 token 延迟** —— 大头在 LLM。检索本身建好 BM25 后亚秒级。要削减延迟:调低 top-K、关掉查询扩展、`chat` 任务换更快的模型。

## 隐私

数据全在本地磁盘(`<vault>/.obsidian/plugins/notebook-ai/` 下),只去往你明确配置的 API 端点。无遥测,无埋点。

要完全离线:本地 embedding(默认)+ 自托管 OpenAI 兼容端点(Ollama、LM Studio、vLLM)—— 插件分不出区别。
