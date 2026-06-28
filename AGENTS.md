# AGENTS.md

本文件适用于 `Pixiv-Viewed-Marker` 仓库根目录及其所有子目录。任何 AI 助手或人工贡献者在本仓库工作时都必须遵守。

## 提交规范（强制）

- **每次 `git commit` 的提交信息必须用中文**。
- 提交信息要简明描述"做了什么/为什么"，避免堆罗列改动文件名。
- 推荐使用前缀（可选）：
  - `feat:` 新增功能
  - `fix:` 修复 bug
  - `refactor:` 不改变外部行为的重构
  - `style:` 仅样式/格式调整
  - `docs:` 文档变更
  - `chore:` 杂项（依赖、配置、清理）
- 一次提交聚焦一个逻辑改动；多个无关改动请拆成多个 commit。如果一组改动逻辑上属于同一个目标，则合并为一次 commit，并用多行中文描述每个子点。
- 不允许使用 `--no-verify` 跳过 hook，不允许 `--amend` 修改已推送的 commit。
- 不允许使用英文 commit 信息（包括 `Initial commit` 之类的模板，需要手动改成中文）。

### 示例

```
feat: 作品页悬浮面板支持中键后台新标签打开

- 新增 background 消息 PVM_OPEN_TAB，使用 chrome.tabs.create 强制后台新标签
- content script 中键 / Ctrl+左键通过 sendMessage 转发到 background
- 新标签插入到当前标签的右侧
```

```
fix: 已关注作者页被误识别为作者作品页

收紧 getRouteContext 中 userArtworks 路由的正则，仅匹配
/users/{id} 和 /users/{id}/(artworks|illustrations|manga)，避免
/following /followers /bookmarks 被错误激活作品网格增强。
```

## 代码风格

- 注释默认写中文，除非所在文件已经明显使用其它语言。
- 优先编辑现有文件，少新建文件。
- 不要为了"以后扩展"提前抽象；先把当前需求做对、做小，需要时再重构。

## 文档同步

- **不要实时更新文档**。开发过程中只改代码，不要顺手改 `README.md` / `doc/architecture.md`。
- 只有当用户明确要求提交时，才走文档同步流程：
  1. 用 `git diff` / `git status` 查看本次实际改动；
  2. 根据真实改动一次性更新 `README.md`（用户行为 / UI 改动）和 `doc/architecture.md`（模块边界、数据结构、消息协议变更）；
  3. 把文档与代码一起提交。
- 提交前请检查 README / architecture.md 是否与代码一致。

## 安全与隐私

- 所有用户数据保存在 `chrome.storage.local`，禁止上传到远端。
- 新增权限（`manifest.json` 中的 `permissions` / `host_permissions` / `optional_permissions`）必须在 README 中说明用途。
