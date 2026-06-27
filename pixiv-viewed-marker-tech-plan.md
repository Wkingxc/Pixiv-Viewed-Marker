# Pixiv Viewed Marker 插件技术方案

## 1. 项目目标

开发一个 Chrome MV3 插件，用于在 Pixiv 页面中永久标记“已经点开过”的作品标题颜色。

核心目标：

1. 在 Pixiv 的关注列表、推荐列表、作品页下方相关推荐等位置，识别作品链接。
2. 如果某个作品曾经被用户点开过，则将该作品标题改成预设颜色。
3. 访问记录由插件本地保存，不依赖浏览器 `:visited` 历史。
4. 清除浏览器历史后，插件记录仍然保留。
5. 支持首次从 Chrome 浏览器历史中导入已有 Pixiv 访问记录。
6. 支持统计已访问作品数量和作者数量。
7. 只作用于 `pixiv.net`，不影响其他网站。

预设已访问标题颜色：

```text
RGB: 244, 118, 162
Hex: #F476A2
Opacity: 1
CSS color: rgba(244, 118, 162, 1)
```

---

## 2. 当前数据规模判断

根据临时统计结果：

```text
Pixiv 历史 URL 记录数：2350
Pixiv 历史访问次数合计：3554

去重后的作品数量：1700
作品 URL 记录数：1705
作品访问次数合计：2321

去重后的作者数量：120
作者 URL 记录数：479
作者页访问次数合计：934

其他 Pixiv URL 记录数：166
```

结论：

1. 当前核心数据量非常小。
2. 第一版不需要 IndexedDB。
3. 使用 `chrome.storage.local` 足够。
4. 后续如果作品记录超过 10 万，再考虑迁移到 IndexedDB。

---

## 3. 插件类型与技术栈

插件类型：

```text
Chrome Extension Manifest V3
```

建议技术栈：

```text
原生 JavaScript
原生 CSS
原生 HTML
chrome.storage.local
chrome.history，可选权限，仅用于历史导入
```

第一版不建议引入 React、Vue、Svelte 等框架。原因：

1. 插件功能简单。
2. 原生 JS 足够实现。
3. 依赖越少，插件越稳定。
4. Pixiv 本身是动态页面，内容脚本保持轻量更重要。

---

## 4. 权限设计

### 4.1 默认权限

默认权限只保留最小集合：

```text
storage
```

默认只注入 Pixiv：

```text
https://www.pixiv.net/*
```

### 4.2 可选权限

历史导入功能需要：

```text
history
```

建议将 `history` 作为可选权限，不要作为默认强权限。

产品交互：

```text
用户点击“从浏览器历史导入”
→ 插件请求 history 权限
→ 用户同意后开始扫描 Chrome 历史
→ 导入完成后，后续运行不再依赖浏览器历史
```

这样用户更容易接受权限说明。

---

## 5. 推荐目录结构

```text
pixiv-viewed-marker/
├── manifest.json
├── src/
│   ├── content/
│   │   ├── content.js
│   │   └── content.css
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   ├── background/
│   │   └── service-worker.js
│   └── shared/
│       ├── constants.js
│       ├── storage.js
│       ├── url-parser.js
│       └── history-importer.js
└── README.md
```

说明：

1. `content.js`：Pixiv 页面内运行，负责记录当前页面、扫描作品链接、改变标题样式。
2. `content.css`：已访问标题样式。
3. `popup.html / popup.js`：插件弹窗，显示统计、导入历史、导出、导入、清空。
4. `service-worker.js`：可用于处理历史导入、消息转发、可选权限请求后的逻辑。
5. `storage.js`：统一封装 `chrome.storage.local`。
6. `url-parser.js`：统一处理 Pixiv URL 解析和归一化。
7. `history-importer.js`：负责扫描 Chrome 历史并生成导入记录。

---

## 6. 数据存储方案

### 6.1 存储方式

第一版使用：

```text
chrome.storage.local
```

理由：

1. 当前作品记录只有约 1700 个。
2. 当前作者记录只有约 120 个。
3. 该规模远低于需要 IndexedDB 的程度。
4. `chrome.storage.local` 开发简单，适合 MVP。
5. 数据保存在插件本地，不会因为清除浏览器历史而丢失。

### 6.2 存储结构

建议存储为一个顶层对象：

```text
schemaVersion
settings
viewedArtworks
viewedUsers
stats
```

推荐结构：

```text
schemaVersion: 1

settings:
  artworkVisitedColor:
    r: 244
    g: 118
    b: 162
    a: 1
  markArtworkTitle: true
  markArtworkImage: false
  markUserName: false
  importBookmarkAddUrls: false

viewedArtworks:
  [artworkId]:
    id: string
    visitedAt: number
    visitCount: number
    source: "history" | "runtime" | "click" | "manual"
    updatedAt: number

viewedUsers:
  [userId]:
    id: string
    visitedAt: number
    visitCount: number
    source: "history" | "runtime" | "click" | "manual"
    updatedAt: number

stats:
  lastHistoryImportAt: number | null
  lastHistoryImportArtworkCount: number
  lastHistoryImportUserCount: number
```

### 6.3 访问记录更新策略

如果记录不存在：

```text
创建记录
visitedAt = 当前时间
visitCount = 1
source = 当前来源
updatedAt = 当前时间
```

如果记录已存在：

```text
visitedAt = max(旧 visitedAt, 当前时间)
visitCount = 旧 visitCount + 1
updatedAt = 当前时间
source 可保留首次来源，也可以更新为最新来源
```

建议：

```text
source 保留首次来源
updatedAt 记录最后更新时间
visitedAt 记录最后访问时间
```

---

## 7. URL 解析与归一化规则

不要依赖 Pixiv 的 CSS class。Pixiv 的 class 可能被打包、压缩、随机化，稳定性较差。

核心识别依据应该是 URL。

### 7.1 作品 URL

主规则：

```text
https://www.pixiv.net/artworks/{artworkId}
```

支持：

```text
/artworks/123456789
/artworks/123456789?comment_id=xxx
/en/artworks/123456789
/zh/artworks/123456789
```

归一化结果：

```text
type = artwork
id = 123456789
normalized = /artworks/123456789
```

处理规则：

1. 只提取数字 ID。
2. 忽略 query 参数。
3. 忽略 hash。
4. locale 前缀可选支持，例如 `/en/artworks/ID`、`/zh/artworks/ID`。
5. 最终只保存 ID，不保存完整 URL 作为主键。

### 7.2 作者 URL

主规则：

```text
https://www.pixiv.net/users/{userId}
```

支持所有以 `/users/{userId}` 开头的路径：

```text
/users/123456
/users/123456/artworks
/users/123456/artworks?p=2
/users/123456/illustrations
/users/123456/illustrations/some-tag
/users/123456/bookmarks/artworks
/users/123456/following
/users/123456/followers
```

归一化结果：

```text
type = user
id = 123456
normalized = /users/123456
```

处理规则：

1. 只要路径以 `/users/{数字ID}` 开头，就认为访问过该作者。
2. 忽略后续子路径。
3. 忽略 query 参数。
4. 最终只保存 user ID。

### 7.3 默认忽略的 URL

以下 URL 不作为核心访问记录：

```text
/tags/...
/search
/bookmark_new_illust.php
/jump.php
/novel/...
/discovery
/ranking.php
/accounts
/settings
```

### 7.4 bookmark_add.php 的处理

历史中可能存在：

```text
/bookmark_add.php?type=illust&illust_id=123456789
```

这个 URL 语义更接近“收藏动作”，不等同于“点进作品页”。

第一版建议：

```text
默认不导入 bookmark_add.php?illust_id=ID
```

可以预留高级选项：

```text
importBookmarkAddUrls: false
```

当用户开启后，再将其作为 artwork ID 导入。

---

## 8. 内容脚本运行逻辑

### 8.1 初始化流程

当 Pixiv 页面加载时：

```text
1. content script 启动。
2. 从 chrome.storage.local 读取 settings、viewedArtworks、viewedUsers。
3. 将 viewedArtworks 的 ID 加载到内存 Set。
4. 将 viewedUsers 的 ID 加载到内存 Set。
5. 解析当前 location.href。
6. 如果当前页面是 /artworks/ID，则记录该作品。
7. 如果当前页面是 /users/ID 或其子路径，则记录该作者。
8. 扫描当前页面中的作品链接并标记已访问标题。
9. 启动 URL 变化监听。
10. 启动 DOM 变化监听。
```

### 8.2 为什么要使用内存 Set

运行时不要每个链接都查询一次 `chrome.storage.local`。

推荐做法：

```text
页面启动时一次性加载全部已访问 ID
→ 转成内存 Set
→ 页面扫描时只查 Set
```

判断成本：

```text
viewedArtworkSet.has(artworkId)
```

这比反复访问 storage 快很多。

### 8.3 当前页面记录

如果当前 URL 是：

```text
/artworks/{id}
```

则记录作品。

如果当前 URL 是：

```text
/users/{id}
/users/{id}/artworks
/users/{id}/illustrations
```

则记录作者。

Pixiv 是 SPA 动态页面，页面内跳转不一定触发完整刷新。需要监听 URL 变化。

建议实现方式：

```text
1. 定时检查 location.href 是否变化。
2. 或 hook history.pushState / history.replaceState。
3. 或两者结合。
```

MVP 可以先用定时检查，间隔 500ms 至 1000ms 即可。

### 8.4 点击时提前记录

为了让用户点击作品后，返回列表时能立刻看到变色，建议监听点击事件：

```text
用户点击 a[href*="/artworks/"]
→ 提取 artwork ID
→ 立即写入内存 Set
→ 异步写入 storage
```

用户点击作者链接时也可同理记录：

```text
用户点击 a[href*="/users/"]
→ 提取 user ID
→ 立即写入内存 Set
→ 异步写入 storage
```

这样即使 Pixiv 页面跳转失败，也可以视为用户主动访问意图。第一版可以接受。

---

## 9. 页面扫描与样式标记

### 9.1 扫描目标

扫描 Pixiv 页面中的作品链接：

```text
a[href*="/artworks/"]
```

对每个链接：

```text
1. 解析 artwork ID。
2. 如果 artwork ID 在 viewedArtworkSet 中：
   - 标记为已访问。
3. 如果不在：
   - 保持默认样式。
```

### 9.2 标记方式

不要直接写内联颜色，建议添加 class 或 data attribute：

```text
class: pvm-viewed-artwork
data-pvm-viewed: true
```

优先推荐：

```text
class = pvm-viewed-artwork
```

### 9.3 标题样式

第一版只改标题颜色，不改图片，不加滤镜，不加复杂角标。

原因：

1. 用户需求是标题变色。
2. 标题变色最接近浏览器 `:visited` 体验。
3. 性能开销最小。
4. 不容易破坏 Pixiv 页面布局。

目标样式：

```text
已访问作品标题颜色：rgba(244, 118, 162, 1)
```

CSS 策略：

```text
.pvm-viewed-artwork {
  color: rgba(244, 118, 162, 1) !important;
}

.pvm-viewed-artwork * {
  color: rgba(244, 118, 162, 1) !important;
}
```

注意：

1. 只建议作用于标题链接或有文字的作品链接。
2. 如果作品链接只包裹图片，不应该强行修改图片样式。
3. 不要默认使用 `filter: grayscale()`，避免性能损耗和视觉干扰。
4. 不要默认加 outline、border、遮罩、角标。

### 9.4 如何判断“标题链接”

Pixiv 不同页面 DOM 可能不同。第一版建议使用启发式策略：

```text
1. 所有 /artworks/ID 链接都参与 ID 判断。
2. 如果该链接自身有可见文本，则对该链接加 pvm-viewed-artwork。
3. 如果该链接没有文本，只包裹图片，则不加标题色。
4. 如果图片链接和标题链接分离，标题链接通常也会包含 /artworks/ID，因此会被标记。
```

如果某些页面标题没有变色，再根据真实 DOM 增加页面适配规则。

---

## 10. Pixiv 动态加载处理

Pixiv 页面会动态加载内容，例如：

```text
关注列表继续滚动
推荐列表继续加载
作品页下方相关推荐加载
SPA 页面跳转
```

因此不能只在页面首次加载时扫描一次。

### 10.1 MutationObserver

需要监听 DOM 变化。

要求：

```text
1. 观察 document.body 的 childList 和 subtree。
2. 不要每次变化都立刻全量扫描。
3. 使用 debounce 或 throttle。
4. 优先处理新增节点中的链接。
5. 使用 WeakSet 或 data 标记避免重复处理同一个 anchor。
```

建议：

```text
debounce 时间：100ms - 300ms
```

### 10.2 避免性能问题

禁止设计：

```text
每次 DOM 变化
→ 读取 chrome.storage.local
→ 扫描整个 document
→ 重新处理所有链接
```

推荐设计：

```text
初始化时读取 storage 到内存 Set
→ MutationObserver 捕获新增节点
→ 只扫描新增节点中的 a[href*="/artworks/"]
→ 用 WeakSet 跳过已处理链接
→ 只给需要变色的链接添加 class
```

MVP 可以先做节流后的全页面扫描，但必须满足：

```text
1. 不重复访问 storage。
2. 扫描函数需要节流。
3. 已处理链接要跳过。
```

---

## 11. 历史导入功能

### 11.1 功能入口

popup 中提供按钮：

```text
从浏览器历史导入 Pixiv 记录
```

点击后：

```text
1. 请求 history 权限。
2. 如果用户拒绝，显示提示。
3. 如果用户同意，开始扫描 Chrome 历史。
4. 查询包含 pixiv.net 的历史记录。
5. 解析作品 ID 和作者 ID。
6. 写入插件本地 storage。
7. 更新 popup 中的统计数量。
```

### 11.2 导入范围

查询关键词：

```text
pixiv.net
```

开始时间：

```text
0
```

最大结果数：

```text
足够大，例如 1000000
```

### 11.3 导入规则

作品导入：

```text
导入 /artworks/{id}
忽略 query
默认不导入 bookmark_add.php?illust_id=ID
```

作者导入：

```text
导入所有 /users/{id} 开头的路径
忽略 query
```

其他 Pixiv URL：

```text
不导入核心记录
只参与统计
```

### 11.4 导入合并策略

如果 storage 中已有记录：

```text
1. 不覆盖更晚的 visitedAt。
2. visitCount 可以累加。
3. source 如果原本是 runtime 或 manual，可以保留原 source。
4. updatedAt 更新为导入时间。
```

建议：

```text
历史导入只补充，不破坏已有运行时记录。
```

---

## 12. Popup 功能设计

第一版 popup 功能：

```text
1. 显示已记录作品数量。
2. 显示已记录作者数量。
3. 显示最后一次历史导入时间。
4. 按钮：从浏览器历史导入。
5. 按钮：导出 JSON。
6. 按钮：导入 JSON。
7. 按钮：清空全部记录。
```

### 12.1 推荐文案

```text
Pixiv Viewed Marker

已记录作品：1700
已记录作者：120
最后导入：2026-06-27 16:06

[从浏览器历史导入]
[导出备份]
[导入备份]
[清空记录]
```

### 12.2 清空记录确认

清空记录必须二次确认：

```text
确定要清空全部 Pixiv 已访问记录吗？此操作不可恢复。
```

---

## 13. 导入导出备份

### 13.1 导出 JSON

导出内容包括：

```text
schemaVersion
settings
viewedArtworks
viewedUsers
stats
exportedAt
```

文件名建议：

```text
pixiv-viewed-marker-backup-YYYYMMDD-HHMMSS.json
```

### 13.2 导入 JSON

导入时：

```text
1. 校验 schemaVersion。
2. 校验 viewedArtworks 和 viewedUsers 是否存在。
3. 按 ID 合并。
4. 不直接覆盖全部数据，除非用户明确选择“覆盖导入”。
```

第一版建议只做“合并导入”。

---

## 14. 性能设计原则

### 14.1 只在 Pixiv 运行

通过 manifest 限定：

```text
https://www.pixiv.net/*
```

插件不应在其他网站注入 content script。

### 14.2 运行时只查内存

页面扫描时只查内存 Set：

```text
viewedArtworkSet.has(id)
```

不要在扫描循环中访问 `chrome.storage.local`。

### 14.3 写入节流

点击多个作品或页面跳转时，写入 storage 可以即时，但建议做简单批处理：

```text
内存先更新
storage 写入延迟 500ms - 1000ms
多个变化合并写一次
```

MVP 可以先即时写入，但需要避免在循环扫描中写入。

### 14.4 样式尽量轻量

第一版只改标题颜色：

```text
color: rgba(244, 118, 162, 1)
```

不要默认使用：

```text
filter
box-shadow
blur
复杂动画
大量伪元素
```

这些容易增加渲染成本。

---

## 15. 用户隐私与安全

插件必须满足：

```text
1. 不上传任何 Pixiv 访问记录。
2. 不请求远程服务器。
3. 不注入第三方脚本。
4. 不读取非 Pixiv 页面内容。
5. history 权限只在用户主动导入历史时请求。
6. 记录只保存在本地 chrome.storage.local。
```

README 和 popup 中应明确说明：

```text
所有记录仅保存在本地浏览器中，不会上传。
```

---

## 16. MVP 功能清单

第一版必须完成：

```text
1. Chrome MV3 插件结构。
2. 只在 https://www.pixiv.net/* 注入 content script。
3. 使用 chrome.storage.local 保存数据。
4. 访问 /artworks/ID 时记录作品。
5. 访问 /users/ID 及其子路径时记录作者。
6. 页面中已访问的 /artworks/ID 标题变成 rgba(244, 118, 162, 1)。
7. 支持 Pixiv SPA 跳转。
8. 支持 Pixiv 动态加载内容。
9. popup 显示作品数量和作者数量。
10. popup 支持从浏览器历史导入。
11. popup 支持导出 JSON 备份。
12. popup 支持导入 JSON 备份。
13. popup 支持清空记录。
```

第一版暂不做：

```text
1. 跨设备同步。
2. 云端备份。
3. IndexedDB。
4. 图片灰度。
5. 已看角标。
6. 复杂统计图表。
7. Firefox 兼容。
8. Safari 兼容。
9. 发布到 Chrome Web Store。
```

---

## 17. 验收标准

### 17.1 历史导入验收

使用当前浏览器历史导入后，数量应接近：

```text
作品数量：约 1700
作者数量：约 120
```

允许略有差异，因为浏览器历史会继续变化。

### 17.2 作品标记验收

操作步骤：

```text
1. 打开 Pixiv 关注列表或推荐列表。
2. 找到一个未访问作品，确认标题是默认白色。
3. 点击进入作品页。
4. 返回列表或重新打开列表。
5. 该作品标题应变成 rgba(244, 118, 162, 1)。
```

### 17.3 清除浏览器历史验收

操作步骤：

```text
1. 完成历史导入。
2. 确认部分作品标题已变色。
3. 清除 Chrome 浏览器历史。
4. 重新打开 Pixiv 页面。
5. 已导入的作品标题仍然变色。
```

### 17.4 动态加载验收

操作步骤：

```text
1. 打开关注列表。
2. 向下滚动，触发更多作品加载。
3. 新加载出的已访问作品也应自动变色。
```

### 17.5 权限验收

要求：

```text
1. 插件默认不应要求 history 权限。
2. 只有点击“从浏览器历史导入”时才请求 history 权限。
3. 插件不应在非 Pixiv 网站运行。
```

---

## 18. 后续可扩展方向

后续可以直接在此基础上扩展：

```text
1. 颜色自定义。
2. 作者名也变色。
3. 图片灰度或透明度。
4. 标记“稍后看”。
5. 手动标记为已看 / 未看。
6. 右键菜单。
7. 记录最后访问时间并在 hover 时显示。
8. 按访问次数排序。
9. 迁移到 IndexedDB。
10. Firefox 版本。
11. Chrome Web Store 发布。
```

---

## 19. 给 Codex 的开发指令建议

建议给 Codex 的第一条任务可以写：

```text
请根据 pixiv-viewed-marker-tech-plan.md 实现一个 Chrome Manifest V3 插件。第一版只做 MVP：使用 chrome.storage.local 保存已访问 Pixiv 作品和作者；支持从 Chrome 历史导入；在 Pixiv 页面中将已访问作品标题改成 rgba(244,118,162,1)；支持动态加载和 SPA 跳转；popup 显示统计、导入历史、导出、导入、清空。不要引入 React/Vue 等框架，使用原生 JS/CSS/HTML。
```
