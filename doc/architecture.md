# Pixiv Viewed Marker 架构说明

## 项目定位

这是一个 Chrome Manifest V3 扩展，只在 `https://www.pixiv.net/*` 运行。核心能力是用本地存储记录已访问 Pixiv 作品/作者，并在 Pixiv 页面中提供更稳定、更明显的已访问标记。

所有数据保存在 `chrome.storage.local`，不上传服务器。

## 目录结构

```text
Pixiv-Viewed-Marker/
├── manifest.json
├── icons/
├── src/
│   ├── background/
│   │   └── service-worker.js
│   ├── content/
│   │   ├── content.js                  # 已访问标记（不依赖作者面板，可独立工作）
│   │   ├── content.css
│   │   ├── author-panel.css            # 作品页悬浮面板 + 作者页网格的样式
│   │   ├── pvm-author-core.js          # 共享状态、API 客户端、缓存、settings/uiState 持久化、quality 工具
│   │   ├── pvm-hover-preview.js        # 作者页缩略图悬停预览浮层
│   │   ├── pvm-author-page.js          # 作者页 / 作品页"相关作品"网格列数 / 最低页数过滤 / 高清缩略图替换
│   │   ├── pvm-artwork-panel.js        # 作品页悬浮"作者作品速览"面板：渲染、事件、缩放、横向拖动
│   │   ├── pvm-artwork-sections.js     # 作品页区块控制：隐藏作者其他作品横幅 / 评论区
│   │   └── pvm-author-bootstrap.js     # 路由调度、watchRoute/watchDom/watchStorage/watchWindow、start
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   └── shared/
│       ├── constants.js
│       ├── storage.js
│       ├── url-parser.js
│       └── history-importer.js
├── doc/
│   └── architecture.md
├── AGENTS.md
└── README.md
```

### 内容脚本加载顺序与命名空间

`manifest.json` 中 `content_scripts.js` 的加载顺序固定为：

1. `shared/constants.js`、`shared/url-parser.js`、`shared/storage.js`：暴露 `globalThis.PVM`。
2. `content/content.js`：已访问标记，独立模块。
3. `content/pvm-author-core.js`：在 `PVM.author` 命名空间下注册常量、共享状态、API 客户端、缓存、settings/uiState 持久化等。
4. `content/pvm-hover-preview.js`：在 `PVM.author.hover` 下注册悬停预览浮层。
5. `content/pvm-author-page.js`：在 `PVM.author.authorPage` 下注册作者页增强（grid 列数 / 最低页数 / 高清缩略图）。
6. `content/pvm-artwork-panel.js`：在 `PVM.author.artworkPanel` 下注册作品页悬浮面板。
7. `content/pvm-artwork-sections.js`：在 `PVM.author.artworkSections` 下注册作品页区块隐藏（作者其他作品横幅 / 评论区）。
8. `content/pvm-author-bootstrap.js`：调用以上模块完成路由调度、watcher 与 `start()` 启动。

每个 `pvm-*.js` 文件都以 `(function (global) { ... })(globalThis)` 包裹，避免污染全局。文件之间只通过 `PVM.author.*` 暴露的函数沟通；共享可变状态由 `pvm-author-core.js` 用 getter / setter / patch 函数对外暴露，避免每个文件持有副本。

## Manifest

`manifest.json` 定义扩展入口：

- 默认权限：`storage`、`tabs`
- 可选权限：`history`
- 注入范围：`https://www.pixiv.net/*`
- popup：`src/popup/popup.html`
- background：`src/background/service-worker.js`
- content scripts：共享模块、访问标记模块、作者作品速览面板模块

`tabs` 权限用于 background 通过 `chrome.tabs.create({ active: false, index: tab.index + 1, openerTabId })` 让作者作品速览卡片支持中键 / Ctrl·Cmd+左键在后台新标签打开。

## Shared 模块

### `constants.js`

定义 schema 版本、默认颜色、默认设置、默认统计、默认页面排除规则。

### `url-parser.js`

负责 Pixiv URL 解析：

- `/artworks/{id}` 解析为作品
- `/users/{id}` 解析为作者
- 页面排除规则归一化为 pathname，例如 `/users/71318526/bookmarks/artworks`

### `storage.js`

封装 `chrome.storage.local`：

- 读取完整数据
- 保存设置
- 记录作品/作者访问
- 合并导入备份
- 添加/移除页面排除规则
- 清空本地数据

### `history-importer.js`

只在用户主动初始化导入时使用 `chrome.history`：

- 查询 Pixiv 浏览历史
- 解析作品和作者 ID
- 合并到本地访问记录
- 更新最后导入时间

## Content 模块

### `content.js`

负责 Pixiv 页面中的已访问标记：

- 启动时读取本地记录到内存 `Set`
- 访问作品页/作者页时记录访问
- 点击作品/作者链接时提前记录访问
- 扫描页面上的作品链接并标记已访问状态
- 支持 SPA 跳转、浏览器回退、动态加载、滚动补扫
- 支持页面排除规则：命中页面不渲染标记/遮罩/隐藏
- 支持设置项：标题变色、图片遮罩、隐藏已访问作品

### `content.css`

定义页面内已访问样式：

- 标题变色
- 图片遮罩
- 隐藏已访问作品卡片

### `pvm-author-core.js`

挂在 `PVM.author` 下，给其它三个模块提供基础设施：

- 常量：`PAGE_SIZE`、`SCALE_STEPS`、HOME_GRID 系列、Quality 字典等。
- 共享可变状态：`settings` / `state` / `uiState` / `currentRouteContext` / `currentArtworkId`，通过 `getSettings/setSettings/getState/patchState/...` 暴露。
- 通用工具：`stripLocale`、`getRouteContext`、`getDisplaySettingsForRoute`（把当前路由映射为统一的"页面显示设置"——作者页读 `authorPage*`、作品页读 `relatedWorks*`）、`escapeHtml`、`chunk`、`clampNumber` 等。
- Quality 工具：`pickImage` / `pickPreviewImage` / `pickHighResImage` / `resolveQualityUrl` / `normalizeWork`。
- API 客户端：`fetchJson` / `fetchCurrentArtwork` / `fetchAuthorWorkIds` / `fetchWorkDetails` / `fetchHighResUrls` / `fetchArtworkDetail`（按 id 单拉，跨作者场景用，带 in-memory 缓存）。
- 收藏 API：`getPixivCsrfToken`（从 `meta[name="global-data"]` 读 token）/ `addBookmark(artworkId)`（POST `/ajax/illusts/bookmarks/add`，JSON body `{illust_id, restrict:0, comment:"", tags:[]}`，带 `X-CSRF-Token` 头）/ `removeBookmark(bookmarkId)`（POST `/ajax/illusts/bookmarks/delete`，form `bookmark_id=<id>`，带 `X-CSRF-Token` 头）/ `fetchBookmarkId(artworkId)`（重新查询当前 bookmark id）。`fetchCurrentArtwork` 同步返回 `bookmarkId`，`fetchAuthorWorksForArtwork` 将其透传到 `state.currentBookmark`，供主图爱心拦截器读取。
- chrome.storage 持久化：`loadUiState` / `saveUiState` / `loadSettings` / `normalizeAuthorSettings` / `getCache` / `setCache`。
- 详情加载：`fetchAuthorWorksByUserId` / `fetchAuthorWorksForArtwork` / `ensureDetailsForPage` / `preloadPageDetails` / `ensureDetailsForIds` / `workForId` / `currentPageFor` / `fallbackWorksFromDom` / `getViewedSet`。

### `pvm-hover-preview.js`

挂在 `PVM.author.hover` 下，负责作者页缩略图鼠标悬停时的独立浮层：

- 拉 `/ajax/illust/{id}` 取大图并显示原图候选信息，命中缓存避免重复拉取。
- 暴露 `applyHoverPreviewBindings(entries)` / `bindHoverPreviewEntry(entry)` / `hideHoverPreview()` / `clearHoverPreview()`。

### `pvm-author-page.js`

挂在 `PVM.author.authorPage` 下，负责作者页 (`/users/{id}` 及其子页) 列表，以及作品页 (`/artworks/{id}`) "相关作品" 列表的增强：

- 在 `/users/{id}`、`/users/{id}/artworks`、`/users/{id}/illustrations`、`/users/{id}/manga` 以及其子路径生效（读 `authorPage*` 设置）；
  也在 `/artworks/{id}` 生效，作用于"相关作品"列表（读 `relatedWorks*` 设置）。具体配置由 `author.getDisplaySettingsForRoute()` 按当前路由选择。
- 通过扫描 `a[href*="/artworks/"]` 找到当前页面作品卡片，并选择包含最多作品卡片的父容器作为作品网格容器；
  在 `/artworks/{id}` 路由会过滤掉指向当前作品自身的卡片，只保留相关作品。
- 给作品网格容器添加 `.pvm-author-home-grid`，通过 CSS 变量控制列数和缩放比例。
- `每行作品数` 设置调整作品列表列数，默认使用已有页面缩略图做 CSS 等比缩放，不重新请求图片。
- `高清缩略图` 开启后，会按当前 DOM 卡片补拉作品详情，并用 Pixiv 接口返回的更清晰封面替换卡片图片；关闭或离开对应路由时恢复原始 `src` / `srcset` / `sizes` / lazy loading 属性。
  - 作者页（同一作者）走 `/ajax/user/{userId}/profile/illusts` 批量接口；相关作品（作者各异）走 `ensureDetailsForIds(..., { perId: true })`，按 id 调 `fetchArtworkDetail`，复用 `singleArtworkCache`。
- `最低页数` 按输入阈值隐藏低页数作品，页数来自 Pixiv 作品详情接口。
- 暴露 `applyUserArtworkPageEnhancements()` / `scheduleUserArtworkEnhancements(delay)` / `clearUserArtworkPageEnhancements()` / `getArtworkListContainer()`。

### `pvm-artwork-panel.js`

挂在 `PVM.author.artworkPanel` 下，负责作品页 (`/artworks/{id}`) 的悬浮"作者作品速览"面板：

- 仅在 `/artworks/{id}` 路由生效；其它路由（作者页、关注列表、收藏页等）不渲染面板和入口图标。
- 收起态：左下角粉色圆形按钮（`left: 16px; bottom: 56px`），位置固定不可拖动，不记忆位置。
- 展开态：锚定右下角 (`right: 20px; bottom: 20px`)，缩放时向左生长。
- 内部按 `2 × 3` 分页显示作者的全部作品。
- 支持按住顶部"当前位置 N/M"文字横向拖动平移面板（仅水平方向，垂直方向锁定）。
- 支持缩放（100% / 120% / 140%）、按钮翻页/滚轮翻页、定位当前作品。
- "定位"按钮跳回当前作品所在分页。
- 当前作品保留在列表中并加遮罩标识。
- 已访问作品跟随原插件设置，只做标题变色/边框，不额外显示"已看"徽章。
- 卡片支持鼠标中键 / Ctrl·Cmd+左键在后台新标签打开：通过 `chrome.runtime.sendMessage` 把 URL 发给 background，由 background 调 `chrome.tabs.create({ active: false, index: tab.index + 1, openerTabId })`，避免 `window.open` 强制前台行为以及"中键自动滚动"导致的双击问题。
- 暴露 `renderPanel()` / `applyPanelUi()` / `setPanelCollapsed(boolean)` / `getPanel()`。

### `pvm-artwork-sections.js`

挂在 `PVM.author.artworkSections` 下，只在 `/artworks/{id}` 路由生效，根据设置隐藏两个区块：

- `artworkPageHideAuthorWorks`：找到包含当前作者主页链接 + 多张该作者其它作品缩略图的 `<section>`，加上 `.pvm-hidden-author-works-banner`（CSS 中 `display: none !important`）。当前作者 ID 来自 `author.getState().userId`（由 `pvm-author-bootstrap` 在 artwork 路由拉作者作品索引时填入）。
- `artworkPageHideComments`：扫描 `<main>` 下含 `h1/h2/h3` 文本匹配 `コメント / Comments / 评论 / 댓글` 的 section，加上 `.pvm-hidden-comments-section`。
- 关闭对应开关或离开 artwork 路由时移除上述 class，DOM 不会被破坏，只是 `display: none`。
- 主图爱心拦截器（`hookMainHeart()`）：在 document `click` capture 阶段拦截 `[data-ga4-label="bookmark_button"]` 内的按钮（仅 artwork 路由 + 不在 `<nav>` 轮播 + 不在 `#pvm-author-panel`），`preventDefault + stopImmediatePropagation` 阻断 Pixiv 自身的"展开多图 / 跳收藏编辑"行为，改调 `author.addBookmark` / `author.removeBookmark`，本地维护 `state.currentBookmark`，并把心形 SVG 两条 path 的 `fill` 涂粉/还原。
- 暴露 `apply()` / `scheduleApply(delay)` / `clear()` / `hookMainHeart()`。bootstrap 在路由切换、`MutationObserver` 触发的 DOM 变化和 `chrome.storage.onChanged` 中调用 `scheduleApply(0)`；`hookMainHeart()` 在模块加载时一次性挂上 capture 监听。

### `pvm-author-bootstrap.js`

调度层，不持有业务状态：

- `loadPanelForCurrentRoute()`：读取 `author.getRouteContext()` 决定是作品页面板还是作者页增强；按需调用 `fetchAuthorWorksForArtwork` / `fetchAuthorWorksByUserId`，失败时降级到 `fallbackWorksFromDom`。
- `watchRoute()` / `watchDom()` / `watchStorage()` / `watchWindow()`：监听 URL 变化、DOM 变化、`chrome.storage` 变化、窗口大小变化，触发相应的重渲。
- `start()`：依次 `loadUiState` → `loadSettings` → `loadPanelForCurrentRoute` → 注册 watcher。

### `author-panel.css`

定义作品页悬浮 UI 和作者页网格增强样式：

- 固定浮动面板。
- 作者作品速览内部网格滚动。
- 底部分页按钮固定。
- 当前作品遮罩。
- 多图数量角标。
- 作者页作品网格列数、等比缩放和动态行间距。
- 作者页高清缩略图开关会保存并恢复原始 `src` / `srcset` / `sizes` / lazy loading 相关属性，降低对 Pixiv lazy loading 的破坏。

## Popup 模块

popup 提供四个标签页：

- 标记：颜色、标题变色、图片遮罩、隐藏已访问作品
- 作者页：每行作品数（`−` / 数字 / `+` 步进按钮）、最低页数过滤、高清缩略图开关、悬停预览开关（作用于作者页 `authorPage*`）
- 作品页：顶部两个开关 `隐藏作者其他作品横幅` / `隐藏评论区`（作用于作品页 `artworkPage*`，由 `pvm-artwork-sections.js` 实现）；下方"相关作品"子区域提供每行作品数、最低页数、悬停预览开关（作用于作品页底部相关作品列表 `relatedWorks*`，不含高清缩略图）
- 其他：合并了原"排除"和"备份"两个页签。排除按页面 URL 禁用当前页面标记渲染；备份提供导出 / 导入 / 清空本地记录

打开 popup 时根据当前激活标签页的 URL 自动聚焦：作者页路由聚焦"作者页"，作品页路由聚焦"作品页"，其它情况聚焦"标记"。

历史导入只作为首次初始化入口，完成后会移除 `history` 权限。

## 数据结构

顶层数据保存在 `chrome.storage.local`：

```text
schemaVersion
settings
viewedArtworks
viewedUsers
exclusions
pvmAuthorPanel:{userId}
pvmAuthorPanelUi
```

`viewedArtworks` 和 `viewedUsers` 使用 ID 作为 key，记录形如 `{ id, visitedAt }`。

`exclusions.pages` 使用 pathname 作为 key。

`settings` 包含访问标记设置、作者页显示设置、相关作品显示设置和作品页区块开关；作者页显示字段包括 `authorPageGridColumns`、`authorPageMinPageCount`、`authorPageUseHighResThumbnails`、`authorPageHighResThumbnailQuality`、`authorPageHoverPreviewEnabled`、`authorPageHoverPreviewQuality`；相关作品显示字段为同名 `relatedWorks*` 系列，但 popup 不暴露 `relatedWorksUseHighResThumbnails`（始终为 `false`）；作品页区块开关包括 `artworkPageHideAuthorWorks`、`artworkPageHideComments`。`*HighResThumbnailQuality` 默认为 `"original"`，`*HoverPreviewQuality` 关闭时为 `"off"`、打开时为 `"original"`。

`pvmAuthorPanel:{userId}` 是作者作品速览缓存，包含作者作品 ID 索引、已加载作品详情和缓存时间。

`pvmAuthorPanelUi` 是作品页作者速览悬浮面板状态，仅包含 `scaleIndex`（缩放档位）、`pageMode`（翻页模式）、`authorPanelExpanded`（是否展开）、`offsetX`（顶部文字拖动后的水平偏移）。**不再记忆位置**：收起态固定左下角，展开态固定右下角。

## Background 模块

`src/background/service-worker.js` 负责后台消息处理：

- `PVM_RECORD_VISIT`：调 `PVM.storage.recordParsedVisit` 记录访问。
- `PVM_OPEN_TAB`：调 `chrome.tabs.create({ url, active, openerTabId, index: senderTab.index + 1 })`，用于作品页悬浮面板卡片中键 / Ctrl·Cmd+左键的后台新标签打开。`active: false` 时新标签在后台；`index: senderTab.index + 1` 让新标签紧邻当前标签右侧，符合浏览器原生中键行为。

## 开发注意

- 不依赖 Pixiv 的动态 class，优先依赖 URL 和稳定接口。
- 页面扫描时不要在循环中访问 storage，必须先加载到内存 Set。
- 作者作品速览依赖 Pixiv 网页端接口，接口变化时应保留 DOM 降级方案。
- 面板内卡片用 bubble 阶段 `click` 监听做 SPA 跳转；中键 / Ctrl·Cmd+左键通过 background 调 `chrome.tabs.create` 后台打开，避免 `window.open` 强制前台、以及 Chrome 中键自动滚动模式导致的"按两次"。
- 隐藏已访问作品不应作用到作者作品速览面板自身。
- 作品页悬浮面板与作者页"已关注作者"等路由互斥：`getRouteContext` 的 userArtworks 正则要严格匹配 `/users/{id}` 和 `/users/{id}/(artworks|illustrations|manga)[/...]`，避免误命中 `/following`、`/followers`、`/bookmarks`。
