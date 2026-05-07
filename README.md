# Zotero LLM Wiki → Obsidian

[![Zotero](https://img.shields.io/badge/Zotero-9-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square)](LICENSE)

一键将 Zotero 文献通过大模型整理成结构化 Wiki 知识库，输出到 Obsidian。

## 功能

- **右键菜单** 在 Zotero 文献列表右击，选择操作
- **生成 Wiki** — 选中文献 / 整个收藏集 → LLM 提取核心信息 → 结构化 Markdown
- **导出笔记** — 保留图片的笔记导出
- **PPT 大纲 / 思维导图 / LaTeX 表格** — 多种格式导出
- **研究方法提取** — 自动提取论文中的方法学信息
- **标注同步** — PDF 批注同步到 Obsidian
- **研读 Digest** — 生成文献研读摘要
- **主题调研** — 基于选定文献的主题分析

## 支持的 LLM

| 服务商 | 模型示例 |
|--------|---------|
| MiniMax | MiniMax-Text-01 |
| Kimi (Moonshot) | kimi-k2.6 |
| DeepSeek | deepseek-v4-pro |
| OpenRouter | Claude Sonnet, Gemini, GPT |
| OpenAI 兼容 | 自定义 API 地址 + 模型 |

## 安装

1. 下载最新的 `.xpi` 文件
2. Zotero → 工具 → 插件 → 齿轮 → 从文件安装
3. 选择 `.xpi`，重启 Zotero
4. 工具 → 插件 → Zotero Wiki Generator → 设置

## 开发

```bash
git clone https://github.com/lichong0429/Zotero-LLM-Wiki-Obsidian.git
cd Zotero-LLM-Wiki-Obsidian
npm install
npm run build          # 构建 XPI
cp .scaffold/build/*.xpi /path/to/desktop/
```

基于 [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) 构建。

## 版本

- **v1.1.21** — 修复 Zotero 9 右键菜单、FTL 架构分离、防崩溃
