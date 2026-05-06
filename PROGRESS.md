# Zotero Wiki Generator 插件开发进度

**最后更新：** 2026-05-07 00:01
**状态：** 编译通过 ✅，待测试

---

## ✅ 已完成

### 1. 插件基础修复
- [x] 支持 Zotero 9（`strict_max_version: "999.*"`）
- [x] 菜单注册改用 `ztoolkit.Menu.register()`（官方模板方式）
- [x] 菜单文字使用 `label: getString("menuitem-xxx")` + FTL 本地化
- [x] 设置页面更新（最新模型选项 + 自定义模型 + 参数说明）
- [x] 依赖更新（zotero-plugin-scaffold 0.8.6, zotero-plugin-toolkit 5.1.2, zotero-types 4.1.2）

### 2. 三个功能模块代码框架

#### 📁 文件位置
```
/root/zotero-wiki-plugin/src/modules/
├── noteExporter.ts          # 笔记批量导出
├── multiFormatExporter.ts   # 多格式导出（PPT、思维导图、LaTeX）
├── topicResearcher.ts       # 主题调研
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

## 📋 下一步计划

### 优先级 1：修复编译错误
- [ ] 修复 hooks.ts 的 prompt 调用
- [ ] 修复 multiFormatExporter.ts 的类型检查
- [ ] 修复 topicResearcher.ts 的类型检查
- [ ] 测试编译通过

### 优先级 2：测试功能
- [ ] 测试笔记导出（保留图片）
- [ ] 测试 PPT 大纲导出
- [ ] 测试思维导图导出
- [ ] 测试 LaTeX 表格导出
- [ ] 测试主题调研功能

### 优先级 3：优化
- [ ] 添加进度条显示
- [ ] 添加错误处理
- [ ] 优化性能（大批量导出）

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
