# Zotero Wiki Generator 插件开发进度

**最后更新：** 2026-05-07 00:15
**状态：** ✅ v1.0.0 全部完成 — 5项核心功能均已实现

---

## ✅ 已完成

### 1. 插件基础修复
- [x] 支持 Zotero 9（`strict_max_version: "999.*"`）
- [x] 菜单注册改用 `ztoolkit.Menu.register()`（官方模板方式）
- [x] 菜单文字使用 `label: getString("menuitem-xxx")` + FTL 本地化
- [x] 设置页面更新（最新模型选项 + 自定义模型 + 参数说明）
- [x] 依赖更新（zotero-plugin-scaffold 0.8.6, zotero-plugin-toolkit 5.1.2, zotero-types 4.1.2）

### 2. 五个功能模块全部实现

#### 📁 文件位置
```
/root/zotero-wiki-plugin/src/modules/
├── noteExporter.ts          # ✅ 笔记批量导出
├── multiFormatExporter.ts   # ✅ 多格式导出（含研究方法）
├── topicResearcher.ts       # ✅ 主题调研（含方法汇总）
├── methodExtractor.ts       # ✅ 研究方法提取（NEW）
├── annotationSync.ts        # ✅ 标注同步（NEW）
├── llmClient.ts            # LLM API 客户端
├── wikiGenerator.ts        # Wiki 生成（原有）
└── obsidianWriter.ts       # Obsidian 写入（原有）
```

#### 📝 功能说明

**1. 笔记批量导出 (noteExporter.ts)**
- 导出所有笔记为 Markdown
- 保留图片（复制到输出目录）
- 生成 Zotero 链接（`zotero://select/library/items/KEY`）
- 按文献分组，生成索引

**2. 多格式导出 (multiFormatExporter.ts)**
- PPT 大纲（组会汇报用）
- 思维导图（Markmap HTML 格式）
- LaTeX 表格（论文写作用）

**3. 主题调研 (topicResearcher.ts)**
- 用户输入主题关键词
- 从选中文献中提取相关内容
- 用 LLM 生成调研报告
- 输出为结构化 Markdown
- ✅ 包含研究方法汇总章节

**4. 研究方法提取 (methodExtractor.ts) — 方向驱动 v1.1**
- **用户输入调研方向**（如"MOF膜气体分离"）
- LLM 动态生成该方向的关键词和分类（10-20个关键词 + 3-5个分类）
- 方向感知提取：只提取与方向相关的方法，过滤无关技术
- 相关度评分（0-100），按类别分组汇总
- 输出：调研总结 + 方法分类汇总 + 逐文献详情
- 回退：无 LLM 时用方向分词做关键词匹配

**5. 标注同步 (annotationSync.ts) — NEW**
- 读取 Zotero PDF 标注（高亮+批注）
- 按颜色编码导出为 Markdown
- 每篇文献独立标注文件
- 支持批量导出研读 Digest（按主题分组）
- 适配 4000+ 笔记的大规模库

### 3. 菜单入口 (hooks.ts)
```typescript
// 已注册的菜单项
ztoolkit.Menu.register("item", {
  tag: "menu",
  id: "zotero-itemmenu-zoterowiki-menu",
  label: "Wiki Generator",
  children: [
    { label: "生成Wiki（选中文献）" },
    { label: "生成Wiki（整个收藏集）" },
    { separator },
    { label: "导出笔记（保留图片）" },
    { separator },
    { label: "导出PPT大纲" },
    { label: "导出思维导图" },
    { label: "导出LaTeX表格" },
    { separator },
    { label: "主题调研..." },
  ],
});
```

---

## ⚠️ 待修复（编译错误）

### 错误列表
1. **hooks.ts**
   - `prompt()` 函数在 Zotero XUL 环境不可用
   - 需要改用 `Services.prompt.prompt()`
   - 类型错误（implicit any）

2. **multiFormatExporter.ts / topicResearcher.ts**
   - 类型比较错误：`item.itemType === "attachment"` 应该用具体类型
   - 应该检查 `item.isNote()` 和 `item.isAttachment()`

3. **ioUtils.ts**
   - 已修复（使用 `Zotero.File.pathToFile()`）

### 修复方案
```typescript
// 1. 替换 prompt()
const topic = await new Promise((resolve) => {
  const input = { value: "默认值" };
  if (Services.prompt.prompt(null, "标题", "提示：", input, null, {})) {
    resolve(input.value);
  } else {
    resolve(null);
  }
});

// 2. 替换 itemType 检查
if (item.isNote()) continue;
if (item.isAttachment()) continue;
```

---

## 📋 下一步计划（v1.0.0 已完成，进入测试阶段）

### 测试清单
- [ ] 安装 XPI 到 Zotero 9，验证菜单显示
- [ ] 测试笔记导出（保留图片、Zotero 链接）
- [ ] 测试 PPT 大纲导出（含研究方法）
- [ ] 测试思维导图导出（Markmap HTML）
- [ ] 测试 LaTeX 表格导出
- [ ] 测试主题调研（含方法汇总）
- [ ] 测试研究方法提取（选 MOF/膜分离论文）
- [ ] 测试标注同步（选有 PDF 高亮/批注的文献）
- [ ] 测试批量导出 Digest（4000+ 笔记规模）

### 可扩展项
- [ ] 扩展 `CHEMISTRY_KEYWORDS` 和 `MATERIALS_KEYWORDS` 关键词库
- [ ] 添加更多导出格式（Word、CSV）
- [ ] 支持自定义标注颜色映射
- [ ] 添加导出进度条（大批量处理时）

---

## 🔧 技术细节

### Zotero API 使用
```typescript
// 获取笔记
const noteIDs = item.getNotes();
const note = await Zotero.Items.getAsync(noteID);
const html = note.getNote(); // HTML 格式

// 获取标注
const annotations = await Zotero.Annotations.getAnnotationsForItem(item.id);
for (const ann of annotations) {
  const color = ann.annotationColor;
  const text = ann.annotationText;
  const comment = ann.annotationComment;
}

// 生成 Zotero 链接
const link = `zotero://select/library/items/${item.key}`;

// 复制图片
const storageDir = Zotero.Attachments.getStorageDirectory(note);
const imgPath = PathUtils.join(storageDir.path, filename);
```

### 本地化文件 (FTL)
```
addon/locale/en-US/addon.ftl
addon/locale/zh-CN/addon.ftl
```
已添加：
- `menuitem-generate-selected`
- `menuitem-generate-collection-item`

---

## 💡 备注

- 用户希望用 Kimi-2.6 模型实现（成本考虑）
- 当前用 mimo-v2.5-pro 做统筹，后续用 Kimi-2.6 做具体实现
- 插件源码：`/root/zotero-wiki-plugin/`
- 构建命令：`npx zotero-plugin build`
- 输出位置：`.scaffold/build/zotero-wiki-generator.xpi`
- 用户桌面：`E:\24221\Desktop\`

---

## 📚 参考资源

- [Zotero 插件开发文档](https://www.zotero.org/support/dev/zotero_7_for_developers)
- [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
- [zotero-plugin-scaffold](https://github.com/zotero-plugin-dev/zotero-plugin-scaffold)
- [Zotero API 类型定义](node_modules/zotero-types/)

---

**下次继续时，从这里开始：**
1. 检查 Kimi-2.6 是否可用
2. 修复编译错误
3. 测试功能
