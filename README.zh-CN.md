# Knowledge AI for Obsidian

简体中文 · [English](./README.md)

为 Obsidian 设计的 AI 助手:基于你笔记里的内容回答问题(附逐句引用),从任意文件夹生成学习指南 / 时间线 / 思维导图 / PPT 幻灯片。

灵感来自 Google NotebookLM,但本地优先、模型解耦 —— 自带 API key,或完全本地跑 embedding。

> 状态:1.0 前。原私有项目首次公开,毛糙在所难免。欢迎 issue / PR。

## 功能

- **检索增强 chat**,回答里 `[N]` 标记可直接跳转到 vault 里对应段落。
- **混合检索** —— BM25(中文分词走 `segmentWords`)+ 向量召回 + 文档级摘要检索,RRF 融合。
- **多格式索引** —— Markdown / PDF(文本层)/ DOCX / XLSX / PPTX。解析在 Web Worker 里跑,大库不卡 UI。
- **图片理解** —— Tesseract OCR(默认 `chi_sim` + `eng`),可选 LLM Vision 处理含图笔记。
- **结构化产物生成** —— 摘要、学习指南、时间线、常见问答、执行简报、思维导图、PPT 幻灯片(支持 PowerPoint 导出)。
- **模型解耦** —— 任何 OpenAI 兼容端点(DeepSeek、Moonshot/Kimi、智谱 GLM、通义千问、OpenAI 等)。本地 embedding 走 `@xenova/transformers`(默认 multilingual-e5-small)。
- **chat 回答存为笔记** —— 一键把带引用的回答存成 vault 里的新笔记。
- **国际化** —— 中文 + 英文,自动跟随 Obsidian 语言设置。

## 截图

_v0.4.0 一起补。_

## 安装

### 通过 Obsidian 第三方插件库

_暂未上架,community-plugins PR 待审。_ 上架后:

1. Obsidian → 设置 → 第三方插件 → 浏览。
2. 搜 "Knowledge AI" 安装。
3. 启用。

### 手动安装(目前)

1. 从 [releases](https://github.com/david46liu/obsidian-knowledge-ai/releases) 下载 `main.js`、`manifest.json`、`styles.css`、以及两个 `ort-wasm*.wasm` 文件。
2. 复制到 `<你的 vault>/.obsidian/plugins/notebook-ai/`。
3. 重启 Obsidian,在"第三方插件"里启用 Knowledge AI。

> 桌面端独占。移动端不在支持范围内(embedding worker + WASM 在移动端不可用)。

## 快速上手

1. **添加 provider** —— 设置 → Providers → 添加。粘贴 OpenAI 兼容的 base URL 和 API key。DeepSeek 用 `https://api.deepseek.com/v1`,Moonshot 用 `https://api.moonshot.cn/v1`,OpenAI 用 `https://api.openai.com/v1`。
2. **分配任务** —— 设置 → 任务模型分配。选 chat 模型,可选 embedding 模型,可选 summary 模型。任务默认走 provider 的 defaultModel。
3. **(可选)启用向量检索** —— 设置 → 向量检索。打开开关;选本地(默认 multilingual-e5-small,首次用 ~110MB 模型自动下载)或外部 API embedding。
4. **创建 Notebook** —— 设置 → Notebooks → 添加,选文件夹。或在左侧文件浏览器右键文件夹 → "从此文件夹创建 Notebook"。
5. **开始 chat** —— 点 Ribbon 图标(或命令面板 → "打开 Notebook AI chat")。提问,引用可点开到源段落。
6. **生成产物** —— chat 视图切到"产物"标签,选产物类型(摘要 / 学习指南 / 时间线 / ...),流式输出。

进阶用法(query 扩展、摘要补齐、OCR、自定义 system prompt、多文件夹 notebook)见 [docs/USAGE.md](./docs/USAGE.md)。

## 配置建议

- **大库(> 2000 文档)** —— 启用文档级摘要:notebook 卡片 → 点"补齐摘要"。提前把每个文档摘要算出来,检索时先选对文档再下钻 chunk。默认并发 1(对国内 provider 友好,避免 429),DeepSeek / OpenAI 可调到 3-4。
- **中文资料** —— 默认分词器不用动,CJK 字符走 n-gram 回退,BM25 不依赖外部中文分词器也能用。
- **成本控制** —— 向量检索默认本地。API 调用只在:chat 补全、可选重排序、可选文档摘要、可选 API embedding 这几处发生。

## 隐私与数据

- 无遥测。插件不上报任何数据。
- 索引和 chunk 存在 `<vault>/.obsidian/plugins/knowledge-ai/data/`(JSONL 格式,插件加载时自动压缩)。
- API 请求直发你配置的 provider。API key 和数据同目录。

## 开发

```bash
npm install
npm run dev        # 增量构建(watch)
npm run build      # 生产构建
npm test           # vitest
npm run type-check # tsc --noEmit
```

部署到测试 vault:

```bash
node scripts/deploy.mjs <vault 路径>
```

贡献流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 鸣谢

- [Obsidian](https://obsidian.md/) —— 平台。
- [`@xenova/transformers`](https://github.com/xenova/transformers.js) 和 [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) —— 本地 embedding。
- [`pdfjs-dist`](https://github.com/mozilla/pdf.js)、[`mammoth`](https://github.com/mwilliamson/mammoth.js)、[`xlsx`](https://github.com/SheetJS/sheetjs)、[`@xmldom/xmldom`](https://github.com/xmldom/xmldom) —— 文件解析。
- [`MiniSearch`](https://github.com/lucaong/minisearch) —— BM25 检索。
- [`Tesseract.js`](https://github.com/naptha/tesseract.js) —— OCR。
- [Google NotebookLM](https://notebooklm.google/) —— 产品形态参考。

## License

[MIT](./LICENSE) —— 详见 LICENSE 文件。
