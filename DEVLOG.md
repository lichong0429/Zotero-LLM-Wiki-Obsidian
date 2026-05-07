# 2026-05-07 Zotero Wiki Generator 开发日志

## 版本迭代

| 版本 | 关键变更 | 结果 |
|------|---------|------|
| v1.1.0 | 原始版本 (commit 378d6c4) | 菜单显示但主标签空 |
| v1.1.15-16 | Logger + 扁平menuitem | 菜单不显示 ❌ |
| v1.1.17 | 加 insertFTLIfNeeded(addon.ftl) | 菜单不显示 ❌ |
| v1.1.18 | try/catch onStartup + fire-and-forget logger | 构建失败（文件污染） |
| v1.1.19 | git checkout 恢复后重做 4 个修复 | 插件持久化 ✅ 菜单不显示 ❌ |
| v1.1.20 | FTL 架构分离（学Linter），addon.ftl→getString, mainWindow.ftl→l10nID | 菜单不显示 ❌, Test Connection ✅ |
| v1.1.21 | 回退 submenu + menu-label 补到 mainWindow.ftl | **菜单显示 ✅** |

## 核心发现

### 1. main/library/item target **必须用 submenu 包装**
- 扁平 menuitem 在顶层不渲染（Zotero 9.0.2）
- submenu 结构正常工作，之前"submenu不展开"是误判
- 真正原因：FTL 键在错误的文件里

### 2. FTL 双系统必须分离
```
addon.ftl      → Localization 类 → getString()（JS代码用）
mainWindow.ftl → insertFTLIfNeeded → l10nID（XUL/MenuManager用）
```
- **绝不能**把同一个 FTL 文件同时用两种机制加载
- **绝不能**把菜单 l10nID 放在 addon.ftl 里

### 3. onStartup 必须 try/catch
- 任何异常都会导致插件重启后消失（Zotero 不持久化）
- 用 `Zotero.debug` 代替文件 logger 避免启动期 I/O 风险

### 4. 学习现有插件是最快的方法
- 参考 Linter for Zotero (zotero-format-metadata@northword.cn)
- 路径: `C:\Users\<user>\AppData\Roaming\Zotero\Zotero\Profiles\<profile>\extensions\`

## 教训
- 不要瞎猜 API 行为，拆已知正常工作的插件对比
- "只修坏的不碰好的" — 多次修复中改坏了已好的功能
- read_file 输出带行号，不能用 execute_code 的 write_file 直接写回（会污染）

## 当前状态
- **v1.1.21** 在桌面上
- 右键 submenu 显示（11个功能项）
- Test Connection 通过
- 插件重启后持久化
- 源码: /root/zotero-wiki-plugin/
