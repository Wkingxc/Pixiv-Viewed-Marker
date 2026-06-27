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
│   │   ├── content.js
│   │   ├── content.css
│   │   ├── author-panel.js
│   │   └── author-panel.css
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
└── README.md
```

## Manifest

`manifest.json` 定义扩展入口：

- 默认权限：`storage`
- 可选权限：`history`
- 注入范围：`https://www.pixiv.net/*`
- popup：`src/popup/popup.html`
- background：`src/background/service-worker.js`
- content scripts：共享模块、访问标记模块、作者作品速览面板模块

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

### `author-panel.js`

负责两个 Pixiv 页面内悬浮 UI：

1. 作品页“作者作品速览”面板。
2. 作者页“作者页显示”控制栏。

作品页面板：

- 在 `/artworks/{id}` 页面显示，默认折叠为右侧圆形入口，避免刷新后遮挡页面。
- 通过 Pixiv 网页端接口读取当前作品作者 ID。
- 请求作者作品 ID 索引。
- 按当前页懒加载作品缩略图详情。
- 使用 `chrome.storage.local` 缓存作者作品索引和缩略图数据。
- 右侧固定面板按 `2 x 3` 分页显示。
- 支持拖动、折叠/展开、缩放、按钮翻页/滚轮翻页。
- “定位”按钮跳回当前作品所在分页。
- 当前作品保留在列表中并加遮罩标识。
- 已访问作品跟随原插件设置，只做标题变色/边框，不额外显示“已看”徽章。
- 接口失败时降级为从页面 DOM 抽取已有作品链接。

作者页控制栏：

- 在 `/users/{id}`、`/users/{id}/artworks`、`/users/{id}/illustrations`、`/users/{id}/manga` 以及其子路径显示。
- 通过扫描 `a[href*="/artworks/"]` 找到当前页面作品卡片，并选择包含最多作品卡片的父容器作为作品网格容器。
- 给作品网格容器添加 `.pvm-author-home-grid`，通过 CSS 变量控制列数和缩放比例。
- `每行` 控件用 `- / +` 调整作品列表列数，使用已有页面缩略图做 CSS 等比缩放，不重新请求图片。
- `最低页数` 控件按输入阈值隐藏低页数作品，页数来自 Pixiv 作者作品详情接口。
- 控制栏支持拖动和左下角横向宽度调整，位置、宽度和筛选参数保存在 `pvmAuthorPanelUi`。

### `author-panel.css`

定义两个悬浮 UI 和作者页网格增强样式：

- 固定浮动面板和控制栏。
- 作者作品速览内部网格滚动。
- 底部分页按钮固定。
- 当前作品遮罩。
- 多图数量角标。
- 作者页作品网格列数、等比缩放和动态行间距。
- 作者页控制栏拖动、横向缩放手柄和按钮/输入控件样式。

## Popup 模块

popup 提供三个标签页：

- 标记：颜色、标题变色、图片遮罩、隐藏已访问作品
- 排除：按页面 URL 禁用当前页面标记渲染
- 备份：导出、导入、清空本地记录

历史导入只作为首次初始化入口，完成后会移除 `history` 权限。

## 数据结构

顶层数据保存在 `chrome.storage.local`：

```text
schemaVersion
settings
viewedArtworks
viewedUsers
exclusions
stats
pvmAuthorPanel:{userId}
pvmAuthorPanelUi
```

`viewedArtworks` 和 `viewedUsers` 使用 ID 作为 key。

`exclusions.pages` 使用 pathname 作为 key。

`pvmAuthorPanel:{userId}` 是作者作品速览缓存，包含作者作品 ID 索引、已加载作品详情和缓存时间。

`pvmAuthorPanelUi` 是悬浮 UI 状态，包含面板位置、缩放、折叠状态、作者页每行数量、最低页数、控制栏位置和宽度。

## 开发注意

- 不依赖 Pixiv 的动态 class，优先依赖 URL 和稳定接口。
- 页面扫描时不要在循环中访问 storage，必须先加载到内存 Set。
- 作者作品速览依赖 Pixiv 网页端接口，接口变化时应保留 DOM 降级方案。
- 面板内链接需要隔离 Pixiv 页面自身点击拦截，避免图片点击第一次不跳转。
- 隐藏已访问作品不应作用到作者作品速览面板自身。
