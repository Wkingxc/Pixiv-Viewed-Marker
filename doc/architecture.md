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
│   │   ├── author-panel.css            # 作品页作者作品速览 + 作者页网格的样式
│   │   ├── pvm-author-core.js          # 共享状态、API 客户端、缓存、settings/uiState 持久化、quality 工具
│   │   ├── pvm-hover-preview.js        # 作者页缩略图悬停预览浮层
│   │   ├── pvm-author-page.js          # 作者页 / 作品页"相关作品"网格列数 / 最低页数过滤 / 高清缩略图替换
│   │   ├── pvm-artwork-panel.js        # 作品页"作者作品速览"面板：右侧栏嵌入、渲染、事件、滚动/翻页模式
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
5. `content/pvm-author-page.js`：在 `PVM.author.authorPage` 下注册作者页 / 作品页"相关作品"增强（grid 列数、最低页数、作者页高清缩略图）。
6. `content/pvm-artwork-panel.js`：在 `PVM.author.artworkPanel` 下注册作品页"作者作品速览"面板：等右栏出现后嵌入、渲染、模式切换、滚动模式下原生 lazy + 当前作品对齐。
7. `content/pvm-artwork-sections.js`：在 `PVM.author.artworkSections` 下注册作品页区块隐藏（作者其他作品横幅 / 评论区）。仅做视觉隐藏，不拦截 Pixiv 自身的请求和爱心按钮。
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

挂在 `PVM.author` 下，给其它模块提供基础设施：

- 常量：`PAGE_SIZE`、HOME_GRID 系列、Quality 字典等。
- 共享可变状态：`settings` / `state` / `uiState` / `currentRouteContext` / `currentArtworkId`，通过 `getSettings/setSettings/getState/patchState/...` 暴露。`uiState` 只剩 `pageMode`（`scroll` / `wheel`）和 `offsetX`。
- 通用工具：`stripLocale`、`getRouteContext`、`getDisplaySettingsForRoute`（把当前路由映射为统一的"页面显示设置"——作者页读 `authorPage*`、作品页读 `relatedWorks*`）、`escapeHtml`、`chunk`、`clampNumber` 等。
- Quality 工具：`pickImage` / `pickPreviewImage` / `pickHighResImage` / `resolveQualityUrl` / `normalizeWork`。
- API 客户端：`fetchJson` / `fetchCurrentArtwork`（仅返回 `userId` / `userName`）/ `fetchAuthorWorkIds` / `fetchWorkDetails` / `fetchHighResUrls` / `fetchArtworkDetail`（按 id 单拉，跨作者场景用，带 in-memory 缓存）。
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
- 给作品网格容器加 `.pvm-author-home-grid`，给真正的作品卡片加 `.pvm-author-home-card`（仅这些 li 进入网格列）；同级的分页 nav / 标题等非卡片节点 CSS 让它独占整行，不会被网格挤掉。
- `每行作品数` 设置调整列数（`--pvm-author-home-columns`）；同时用 `zoom: var(--pvm-author-home-scale)` 真实放大卡片占位（行数越少卡片越大），避免 `transform: scale()` 视觉溢出遮住分页 nav。
- `高清缩略图`（仅作者页）开启后，会按当前 DOM 卡片补拉作品详情，并用 Pixiv 接口返回的更清晰封面替换卡片图片；关闭或离开对应路由时恢复原始 `src` / `srcset` / `sizes` / lazy loading 属性。
  - 作者页（同一作者）走 `/ajax/user/{userId}/profile/illusts` 批量接口；相关作品（作者各异）走 `ensureDetailsForIds(..., { perId: true })`，按 id 调 `fetchArtworkDetail`，复用 `singleArtworkCache`。
- `最低页数` 按输入阈值隐藏低页数作品，页数来自 Pixiv 作品详情接口。
- 暴露 `applyUserArtworkPageEnhancements()` / `scheduleUserArtworkEnhancements(delay)` / `clearUserArtworkPageEnhancements()` / `getArtworkListContainer()`。

### `pvm-artwork-panel.js`

挂在 `PVM.author.artworkPanel` 下，负责作品页 (`/artworks/{id}`) 的"作者作品速览"面板：

- 仅在 `/artworks/{id}` 路由生效；其它路由不渲染面板。
- **只嵌入右栏一种形态**：首次 `renderPanel()` 会 `await waitForEmbedHost()`（每 100ms 轮询，最多 10 秒），等 Pixiv 右栏 `<aside>` 真正出现再创建面板和发起图片预加载。右栏 10 秒未出现就放弃挂载，避免脏初始化。
- 嵌入时给父容器加 `.pvm-artwork-layout-host`、给右侧栏 `<aside>` 加 `.pvm-artwork-side-rail`，避免依赖 Pixiv 动态 class。宽屏下（`min-width: 1180px`）用 `--pvm-artwork-rail-width: clamp(392px, 28vw, 460px)` 扩展右栏，面板 `width: 100%` 填满。
- 两种浏览模式：
  - `scroll`（默认）：一次性渲染作者全部作品，2 列网格纵向滚动；卡片用 `aspect-ratio: 1/1; height: 0; padding-top: 100%` 撑方形，wrap/thumb 绝对定位充满。`<img loading="lazy" decoding="async">` 由浏览器原生 lazy 处理按需加载，不再自制 IntersectionObserver / scroll handler。渲染时若发现 `workMap` 还缺 id，调 `ensureDetailsForIds(state.ids)` 拉全部详情、完成后重渲一次填上 `src`。
  - `wheel`：`2 × 3` 网格 + 滚轮翻页；底部 `定位` 按钮跳回当前作品所在页。
- `alignCurrentCardWhenReady()`：滚动模式下用轮询等 grid 拿到非零 `clientHeight` 那一刻，把当前作品 `scrollTop` 对齐到视野中央。
- 当前作品保留在列表中并加遮罩标识。
- 已访问作品跟随原插件设置，只做标题变色 / 边框，不额外显示"已看"徽章。
- 卡片点击：普通左键在 `mousedown` 阶段触发当前标签 SPA 跳转，避免 Pixiv 懒加载重排吞掉 `click`；中键 / Ctrl·Cmd+左键通过 `chrome.runtime.sendMessage` 把 URL 发给 background，由 background 调 `chrome.tabs.create({ active: false, index: tab.index + 1, openerTabId })` 后台新标签打开。
- 暴露 `renderPanel()` / `applyPanelUi()` / `remountPanelForCurrentRoute()` / `findEmbedHost()` / `getPanel()`。

### `pvm-artwork-sections.js`

挂在 `PVM.author.artworkSections` 下，只在 `/artworks/{id}` 路由生效，根据设置隐藏两个区块：

- `artworkPageHideAuthorWorks`：找到包含当前作者主页链接 + 多张该作者其它作品缩略图的 `<section>`，加上 `.pvm-hidden-author-works-banner`（CSS 中 `display: none !important`）。当前作者 ID 来自 `author.getState().userId`（由 `pvm-author-bootstrap` 在 artwork 路由拉作者作品索引时填入）。仅做视觉隐藏，Pixiv 自身的请求和图片不受影响。
- `artworkPageHideComments`：扫描 `<main>` 下含 `h1/h2/h3` 文本匹配 `コメント / Comments / 评论 / 댓글` 的 section，加上 `.pvm-hidden-comments-section`。
- 关闭对应开关或离开 artwork 路由时移除上述 class，DOM 不会被破坏，只是 `display: none`。
- 暴露 `apply()` / `scheduleApply(delay)` / `clear()`。bootstrap 在路由切换、`MutationObserver` 触发的 DOM 变化和 `chrome.storage.onChanged` 中调用 `scheduleApply(0)`。

### `pvm-author-bootstrap.js`

调度层，不持有业务状态：

- `loadPanelForCurrentRoute()`：读取 `author.getRouteContext()` 决定是作品页面板还是作者页增强；按需调用 `fetchAuthorWorksForArtwork` / `fetchAuthorWorksByUserId`，失败时降级到 `fallbackWorksFromDom`。
- `watchRoute()` / `watchDom()` / `watchStorage()` / `watchWindow()`：监听 URL 变化、DOM 变化、`chrome.storage` 变化、窗口大小变化，触发相应的重渲。
- `start()`：依次 `loadUiState` → `loadSettings` → `loadPanelForCurrentRoute` → 注册 watcher。

### `author-panel.css`

定义作品页作者作品速览 UI 和作者页网格增强样式：

- 作品页作者作品速览只有嵌入右栏一种形态：`.pvm-artwork-layout-host` / `.pvm-artwork-side-rail` 在宽屏下扩展 Pixiv 右栏宽度。
- 嵌入面板自身不设置视口高度上限，避免翻页模式第三行预览被父级 `overflow: hidden` 裁掉；滚动模式只在 `.pvm-ap-grid.is-scrollable` 上限制高度。
- `.pvm-ap-grid` 翻页模式 2 列、`grid-auto-rows: auto`、卡片 `aspect-ratio: 1/1` + 绝对定位 wrap/thumb；滚动模式 `.is-scrollable` 用 `!important` 覆盖、`height: 0; padding-top: 100%` 撑方形，纵向 `overflow-y: auto`。
- 翻页模式 footer / 滚轮提示样式；当前作品遮罩、多图数量角标。
- 作者页作品网格列数（`--pvm-author-home-columns`）+ `zoom` 缩放（`--pvm-author-home-scale`）；非卡片同级节点 `grid-column: 1 / -1` 独占整行避免被挤掉。
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

`pvmAuthorPanelUi` 只持久化面板的浏览模式：`pageMode`（`scroll` / `wheel`，历史 `slider` / `buttons` 归一化为 `scroll`），以及为兼容老数据保留的 `offsetX`（目前未参与渲染）。面板不再记忆位置 / 缩放 / 展开状态。

## Background 模块

`src/background/service-worker.js` 负责后台消息处理：

- `PVM_RECORD_VISIT`：调 `PVM.storage.recordParsedVisit` 记录访问。
- `PVM_OPEN_TAB`：调 `chrome.tabs.create({ url, active, openerTabId, index: senderTab.index + 1 })`，用于作品页作者作品速览卡片中键 / Ctrl·Cmd+左键的后台新标签打开。`active: false` 时新标签在后台；`index: senderTab.index + 1` 让新标签紧邻当前标签右侧，符合浏览器原生中键行为。

## 开发注意

- 不依赖 Pixiv 的动态 class，优先依赖 URL 和稳定接口。
- 页面扫描时不要在循环中访问 storage，必须先加载到内存 Set。
- 作者作品速览依赖 Pixiv 网页端接口，接口变化时应保留 DOM 降级方案。
- 面板内卡片普通左键在 `mousedown` 阶段触发当前标签跳转，避免嵌入 Pixiv 右侧栏后懒加载重排吞掉第一次 `click`；中键 / Ctrl·Cmd+左键通过 background 调 `chrome.tabs.create` 后台打开，避免 `window.open` 强制前台、以及 Chrome 中键自动滚动模式导致的"按两次"。
- 隐藏已访问作品不应作用到作者作品速览面板自身。
- 作品页作者作品速览与作者页"已关注作者"等路由互斥：`getRouteContext` 的 userArtworks 正则要严格匹配 `/users/{id}` 和 `/users/{id}/(artworks|illustrations|manga)[/...]`，避免误命中 `/following`、`/followers`、`/bookmarks`。
