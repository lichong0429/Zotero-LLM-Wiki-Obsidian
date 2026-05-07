# Zotero Wiki Generator 插件开发进度

**最后更新：** 2026-05-07 17:53
**状态：** ⚠️ 用户切换模型处理中 — 当前 DeepSeek API 响应格式与插件解析逻辑不匹配，需换模型验证
**构建产物：** `zotero-wiki-generator.xpi`

---

## ✅ 已完成

### 1. 插件基础修复
- [x] 支持 Zotero 9（`strict_max_version: "999.*"`）
- [x] **v1.1.10 修复**：右键菜单改用 `Zotero.MenuManager.registerMenu()`（Zotero 9 原生 API）
- [x] **v1.1.10 修复**：`ztoolkit.Menu.register` 在 toolkit 5.1.2 中已移除，改用 `MenuManager`
- [x] 菜单文字使用 `l10nID` + FTL 本地化
- [x] 设置页面更新（最新模型选项 + 自定义模型 + 参数说明）
- [x] **v1.1.9 修复**：浏览路径按钮改用 `Services.prompt.prompt()`（Zotero 9 中 `nsIFilePicker` 已移除）
- [x] **v1.1.9 新增**：设置页面增加"检测模型可用性"按钮
- [x] **v1.1.10 修复**：`locale.ts` 改用 `Localization` 类加载 `addon.ftl`（官方模板方式）
- [x] 依赖更新（zotero-plugin-scaffold 0.8.6, zotero-plugin-toolkit 5.1.2, zotero-types 4.1.2）

### 2. 六个功能模块全部实现

#### 📁 文件位置
```
/root/zotero-wiki-plugin/src/modules/
├── noteExporter.ts          # ✅ 笔记批量导出
├── multiFormatExporter.ts   # ✅ 多格式导出（含研究方法）
├── topicResearcher.ts       # ✅ 主题调研（含方法汇总）
├── methodExtractor.ts       # ✅ 研究方法提取（方向感知 v1.1）
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

**4. 研究方法提取 (methodExtractor.ts) — 方向感知 v1.1 ⭐**
- **用户输入调研方向**（如"MOF膜气体分离"）
- LLM 动态生成该方向的关键词和分类（10-20个关键词 + 3-5个分类）
- 方向感知提取：只提取与方向相关的方法，过滤无关技术
- 相关度评分（0-100），按类别分组汇总
- 输出：调研总结 + 方法分类汇总 + 逐文献详情
- 回退：无 LLM 时用方向分词做关键词匹配

**5. 标注同步 (annotationSync.ts)**
- 读取 Zotero PDF 标注（高亮+批注）
- 按颜色编码导出为 Markdown
- 每篇文献独立标注文件
- 支持批量导出研读 Digest（按主题分组）
- 适配 4000+ 笔记的大规模库

**6. Wiki 生成 (wikiGenerator.ts)**
- 从选中文献生成 LLM 驱动的 Wiki 页面
- 输出到 Obsidian 或本地 Markdown

### 3. 菜单入口 (hooks.ts)

#### v1.1.10 最终方案：`Zotero.MenuManager.registerMenu()`

```typescript
function registerMenuItems(win: _ZoteroTypes.MainWindow) {
  const menuIcon = `chrome://${addon.data.config.addonRef}/content/icons/favicon@0.5x.png`;

  // 必须先加载 addon.ftl，否则 l10nID 无法解析
  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-addon.ftl`,
  );

  Zotero.MenuManager.registerMenu({
    menuID: "zoterowiki-item-menu",
    pluginID: addon.data.config.addonID,
    target: "main/library/item",
    menus: [
      {
        menuType: "submenu",
        l10nID: "zoterowiki-menu-label",  // Wiki Generator
        icon: menuIcon,
        menus: [
          { menuType: "menuitem", l10nID: "zoterowiki-generate-selected",
            onCommand: (_event, context) => {
              const items = (context as _ZoteroTypes.MenuManager.LibraryMenuContext).items || [];
              onGenerateFromItems(items, "selected");
            }},
          { menuType: "menuitem", l10nID: "zoterowiki-generate-collection",
            onCommand: (_event, context) => {
              const items = (context as _ZoteroTypes.MenuManager.LibraryMenuContext).items || [];
              onGenerateFromItems(items, "collection");
            }},
          { menuType: "separator" },
          { menuType: "menuitem", l10nID: "zoterowiki-export-notes",
            onCommand: (_event, context) => {
              const items = (context as _ZoteroTypes.MenuManager.LibraryMenuContext).items || [];
              onExportNotesFromItems(items);
            }},
          // ... 其他菜单项
        ],
      },
    ],
  });
}
```

**关键变化（v1.1.10）：**
1. `ztoolkit.Menu.register()` → `Zotero.MenuManager.registerMenu()`（toolkit 5.1.2 已移除 `ztoolkit.Menu`）
2. `label: getString(...)` → `l10nID: "zoterowiki-menu-label"`（MenuManager 只接受 l10nID）
3. `onCommand: () => {...}` → `onCommand: (_event, context) => {...}`（从 context 获取选中文献）
4. 新增 `win.MozXULElement.insertFTLIfNeeded()` 加载 `addon.ftl`（MenuManager 依赖 FTL 加载）
5. `tag: "menu"` → `menuType: "submenu"`，`tag: "menuitem"` → `menuType: "menuitem"`，`tag: "menuseparator"` → `menuType: "separator"`

---

## 🔧 调试记录

### 2026-05-07 v1.1.10 右键菜单最终修复

#### 问题现象
安装插件后，右键点击文献没有 Wiki Generator 菜单。之前尝试 `ztoolkit.Menu.register()` 也无效。

#### 根本原因
**`ztoolkit.Menu` 在 toolkit 5.1.2 中已完全移除！**

```bash
# 检查 toolkit 源码 — 没有 Menu 类
grep -rn "Menu" node_modules/zotero-plugin-toolkit/dist/ | grep -i "register\|class.*Menu"
# → 空输出，确认 Menu 类不存在
```

官方模板 `examples.ts` 虽然还展示 `ztoolkit.Menu.register()`，但实际 toolkit 5.1.2 的构建产物中已经没有这个 API。

#### 修复方案：改用 `Zotero.MenuManager.registerMenu()`（Zotero 9 原生 API）

**关键代码变化：**

| 旧代码 (`ztoolkit.Menu`) | 新代码 (`Zotero.MenuManager`) |
|-------------------------|------------------------------|
| `ztoolkit.Menu.register("item", {...})` | `Zotero.MenuManager.registerMenu({target: "main/library/item", ...})` |
| `tag: "menu"` | `menuType: "submenu"` |
| `tag: "menuitem"` | `menuType: "menuitem"` |
| `tag: "menuseparator"` | `menuType: "separator"` |
| `label: getString("...")` | `l10nID: "zoterowiki-menu-label"` |
| `onCommand: () => {...}` | `onCommand: (_event, context) => {...}` |
| 无 FTL 加载 | `win.MozXULElement.insertFTLIfNeeded("zoterowiki-addon.ftl")` |
| `Zotero.getActiveZoteroPane().getSelectedItems()` | `(context as LibraryMenuContext).items` |

**FTL 加载顺序（关键！）：**
```
onMainWindowLoad:
  1. insertFTLIfNeeded("zoterowiki-addon.ftl")   ← MenuManager 需要
  2. insertFTLIfNeeded("zoterowiki-mainWindow.ftl") ← 侧边栏需要
  3. registerMenuItems()  ← 调用 MenuManager.registerMenu()
```

#### 教训
- **不要依赖官方模板源码中的 API 示例** — 模板源码和实际 toolkit 构建产物可能不一致
- **检查 `node_modules/` 中的实际 API** 比看文档更可靠
- Zotero 9 的 `MenuManager` 是唯一的菜单注册途径

---

### 2026-05-07 v1.1.9 设置页面修复 + 模型检测

#### 修复 1：浏览路径按钮无反应
**原因：** Zotero 9 / Firefox 128 ESR 中 `Components.interfaces.nsIFilePicker` 已移除
**修复：** 改用 `Services.prompt.prompt()` 弹出文本输入框

```typescript
// ❌ 旧的 — Zotero 9 中不可用
const fp = Components.classes["@mozilla.org/filepicker;1"].createInstance(
  Components.interfaces.nsIFilePicker
);

// ✅ 新的 — 使用 Services.prompt
const input = { value: currentPath };
const result = Services.prompt.prompt(
  win, "Wiki Generator", "请输入 Wiki 输出文件夹路径：", input, null, ""
);
```

#### 新增：检测模型可用性按钮
**位置：** 设置面板中，"自定义 Base URL"下方
**功能：** 用当前配置发一个极简 LLM 请求（`"Hi"`，max_tokens=5），验证 API Key 和模型是否可用
**反馈：** 绿色成功提示 / 红色错误提示（带具体错误信息）

---

### 2026-05-07 v1.1.8 设置页面修复

#### 问题 1：设置页面侧边栏显示 `prefs-title`（键名而非翻译）
**原因：** `hooks.ts` 用 `getString("prefs-title")` 从 `addon.ftl` 读取，但 FTL 加载时机可能不对
**修复：** 改为硬编码 `label: "Zotero Wiki Generator"`

#### 问题 2：设置页面打不开（空白/崩溃）
**原因：** `preferences.xhtml` 构建后的 `data-l10n-id` 是 `zoterowiki-pref-title`（带前缀），但 FTL 文件里的键写错了
**修复：** FTL 里用不带前缀的键：`pref-title`、`pref-provider` 等。zotero-plugin-scaffold 构建时会自动给 `data-l10n-id` 加前缀。

#### 问题 3：locale.ts 初始化失败
**原因：** 旧的 `locale.ts` 使用 `Zotero.Intl.strings` 直接读取，但 `addon.ftl` 从未被加载到全局 Intl 存储中
**修复：** 改用官方模板的 `Localization` 类方式：
```typescript
function initLocale() {
  const Localization = ztoolkit.getGlobal("Localization");
  const l10n = new Localization([`${config.addonRef}-addon.ftl`], true);
  addon.data.locale = { current: l10n };
}

function getString(localeString: string): string {
  const localStringWithPrefix = `${config.addonRef}-${localeString}`;
  const pattern = addon.data.locale?.current.formatMessagesSync([
    { id: localStringWithPrefix },
  ])[0] as { value: string | null };
  return pattern?.value || localStringWithPrefix;
}
```

**关键教训：**
> zotero-plugin-scaffold 构建 `preferences.xhtml` 时：
> 1. **检查阶段**：读取原始 `data-l10n-id="pref-title"`，检查 FTL 里是否有 `pref-title`
> 2. **构建阶段**：替换 `__addonRef__`，同时给 `data-l10n-id` 加前缀 → `zoterowiki-pref-title`
>
> 所以 `preferences.ftl` 里的键必须**不带前缀**（`pref-title`），构建后会自动匹配。

---

### 2026-05-07 v1.1.0 右键菜单不显示 — 根本原因分析（旧记录，已过时）

#### 问题现象
安装插件后，右键点击文献没有 Wiki Generator 菜单，甚至其他插件的右键菜单也消失。

#### 根本原因（三层）

**第 1 层：FTL 字符串缺失**
`hooks.ts` 使用 `l10nID: "zoterowiki-generate-selected"` 注册菜单，但 `addon.ftl` 文件里**完全没有这些字符串**！

**第 2 层：Zotero 9 MenuManager API 兼容性**
最初尝试用 `Zotero.MenuManager.registerMenu()`，但这个 API 在 Zotero 9 早期版本不稳定。

**第 3 层：菜单注册失败导致连锁反应**
如果菜单注册代码在 `onMainWindowLoad` 中抛出异常，后续代码不会执行。

#### 当时的修复方案（已废弃，v1.1.10 又改回 MenuManager）
1. 补全 FTL 字符串
2. 改用 `ztoolkit.Menu.register()`（当时以为这个 API 存在）
3. 改用 `label` 而非 `l10nID`
4. 使用 `Zotero.getActiveZoteroPane().getSelectedItems()` 获取选中文献

**废弃原因：** `ztoolkit.Menu` 在 toolkit 5.1.2 中已移除，不存在这个 API。

---

## ⚠️ 已知问题

### 编译状态
- ✅ 构建通过：`npx zotero-plugin build` 成功，无警告
- ✅ 产物：`zotero-wiki-generator.xpi` (55KB)

### 待验证
- [ ] v1.1.10 右键菜单在 Zotero 9.0.2 中实际显示
- [ ] v1.1.9 浏览路径按钮弹窗正常
- [ ] v1.1.9 检测模型可用性按钮正常工作
- [ ] 设置页面正常打开（FTL 加载正确）

---

## 📋 测试清单（v1.1.0 待测试）

### 基础功能
- [ ] 安装 XPI 到 Zotero 9，验证菜单显示
- [ ] 测试笔记导出（保留图片、Zotero 链接）
- [ ] 测试 PPT 大纲导出（含研究方法）
- [ ] 测试思维导图导出（Markmap HTML）
- [ ] 测试 LaTeX 表格导出

### v1.1 核心功能
- [ ] 测试主题调研（含方法汇总）
- [ ] 测试**方向感知研究方法提取**（选 MOF/膜分离论文，输入方向看关键词生成）
- [ ] 测试标注同步（选有 PDF 高亮/批注的文献）
- [ ] 测试批量导出 Digest（4000+ 笔记规模）

### 性能与稳定性
- [ ] 大规模库（9000+ PDF）响应速度
- [ ] LLM API 超时处理
- [ ] 无网络时的降级策略

---

## 🔮 未来计划（v1.2+）

### 可扩展项
- [ ] 扩展 `CHEMISTRY_KEYWORDS` 和 `MATERIALS_KEYWORDS` 关键词库
- [ ] 添加更多导出格式（Word、CSV）
- [ ] 支持自定义标注颜色映射
- [ ] 添加导出进度条（大批量处理时）
- [ ] 支持 Kimi-2.6 模型（降低成本）
- [ ] 缓存 LLM 结果，避免重复调用
- [ ] 支持自定义 Prompt 模板

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
addon/locale/en-US/addon.ftl          # 右键菜单字符串
addon/locale/en-US/preferences.ftl  # 设置页面字符串（键名无前缀）
addon/locale/en-US/mainWindow.ftl   # 主窗口字符串
addon/locale/zh-CN/addon.ftl
addon/locale/zh-CN/preferences.ftl
addon/locale/zh-CN/mainWindow.ftl
```

**FTL 键名规则：**
- `addon.ftl` 里的键：带前缀（如 `zoterowiki-menu-label`）— 构建工具不会修改
- `preferences.ftl` 里的键：**不带前缀**（如 `pref-title`）— 构建工具不会给 `data-l10n-id` 加前缀

---

## 💡 备注

- 用户希望用 Kimi-2.6 模型实现（成本考虑）
- 当前用 mimo-v2.5-pro 做统筹，后续用 Kimi-2.6 做具体实现
- 插件源码：`/root/zotero-wiki-plugin/`
- 构建命令：`npx zotero-plugin build`
- 输出位置：`.scaffold/build/zotero-wiki-generator.xpi`
- 用户桌面路径

---

## 📚 参考资源

- [Zotero 插件开发文档](https://www.zotero.org/support/dev/zotero_7_for_developers)
- [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
- [zotero-plugin-scaffold](https://github.com/zotero-plugin-dev/zotero-plugin-scaffold)
- [Zotero API 类型定义](node_modules/zotero-types/)

---

---

## 🐛 v1.1.11-v1.1.15 调试记录（2026-05-07）

### 用户反馈的问题
1. **插件安装后重启消失** — 安装成功，关闭 Zotero 再打开后插件不见了，需要重新安装
2. **右键菜单没有 Wiki Generator 选项** — 之前 v1.1.8 有，后续版本消失
3. **"检测模型可用性"报错** — 返回数据格式异常（使用 DeepSeek）

### 排查过程

#### 问题1：插件重启后消失
**猜测原因：**
- `bootstrap.js` 的 `startup()` 中 `await Zotero.ZoteroWiki.hooks.onStartup()` 抛出异常
- Zotero 记录插件启动失败，下次不加载
- 可能 `logger.ts` 中的 `IOUtils` 或 `Zotero.getZoteroDirectory()` 在启动阶段不可用

**尝试的修复：**
- v1.1.14：logger 改用 `Zotero.debug` 保底 + 文件写入降级
- v1.1.15：将 `initLogger()` 从 `onStartup` 移到 `onMainWindowLoad`，避免启动时阻塞

**待验证：** 需要用户测试 v1.1.15 是否仍然消失

#### 问题2：右键菜单消失
**猜测原因：**
- `onStartup` 失败导致 `onMainWindowLoad` 根本没执行
- `registerMenuItems()` 在 `onMainWindowLoad` 中调用
- 如果 `onStartup` 抛异常，整个插件初始化中断

**代码确认：** 构建后的 JS 中 `registerMenuItems` 代码存在，包含多个 `menuitem` + `separator`

#### 问题3：检测模型可用性失败
**猜测原因：**
- DeepSeek API 响应格式与 OpenAI 标准格式不同
- `testConnection()` 只检查了 `choices[0].message.content`
- 需要查看实际响应内容

**已改进：** v1.1.11+ 增加了更多响应格式检查，并显示实际响应内容

### 关键教训
1. **Zotero 9 API 兼容性** — `Zotero.File.*` 旧 API 已废弃，必须用 `IOUtils`
2. **异步初始化** — `onStartup` 中的 async 操作必须用 try/catch 包裹，不能阻塞后续代码
3. **插件持久化** — 如果 `startup()` 抛异常，Zotero 可能不保存插件状态

### 用户切换模型
- **原因**：DeepSeek API 响应格式与插件 `testConnection()` 解析逻辑不匹配，检测始终失败
- **切换目标**：deepseek-v4-pro（用户自行在其他模型客户端验证）
- **我的模型配置**：已同步更新为 deepseek-v4-pro

### 当前阻塞问题
1. **插件安装后重启消失** — 最严重，需要优先解决
2. **右键菜单没有 Wiki Generator 选项** — 依赖问题1解决
3. **检测模型可用性失败** — 可能是 DeepSeek 响应格式问题，换模型后验证

### 下一步（等用户测试反馈）
1. 用户用 deepseek-v4-pro 测试插件功能
2. 如果插件仍然重启消失，回滚到 v1.1.0 最简代码排查
3. 如果插件持久化正常，逐步修复右键菜单和检测功能

---

**下次继续时，从这里开始：**
1. 确认 v1.1.15 插件是否能持久化（安装后重启不消失）
2. 如果仍然消失，检查 Zotero 错误控制台和 debug output
3. 右键菜单和检测功能在插件持久化后再修复
