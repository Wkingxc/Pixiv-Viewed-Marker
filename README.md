# Pixiv Viewed Marker

Chrome Manifest V3 extension for locally marking Pixiv artwork titles that have already been opened.

## 技术方案精简版

- 使用原生 JavaScript/CSS/HTML，不引入框架和构建流程，直接作为未打包扩展加载。
- 仅在 `https://www.pixiv.net/*` 注入 content script，默认权限只有 `storage`；浏览器历史导入只作为首次初始化入口，导入完成后会移除 `history` 权限并隐藏入口。
- 使用 `chrome.storage.local` 保存 `viewedArtworks`、`viewedUsers`、页面排除规则、`settings`、`stats`，数据只保存在本地。
- URL 解析以 `/artworks/{id}` 和 `/users/{id}` 为稳定依据，不依赖 Pixiv 的动态 class。
- content script 启动后一次性读取访问记录和页面排除规则到内存 `Set`，扫描页面链接时只查内存；通过点击监听、URL 轮询、storage 变化监听、滚动补扫和 `MutationObserver` 支持 SPA 跳转、动态加载和设置即时生效。
- popup 使用“标记 / 排除 / 备份”三标签页：标记页支持标题颜色、标题变色、图片遮罩和隐藏已访问作品；排除页支持按 Pixiv 页面 URL 禁用当前页面的标记渲染；备份页提供 JSON 导出、合并导入、清空记录。

## 使用方式

1. 打开 Chrome `chrome://extensions/`。
2. 启用开发者模式。
3. 选择“加载已解压的扩展程序”。
4. 选择本项目目录。

## 隐私说明

所有访问记录仅保存在本地浏览器的 `chrome.storage.local` 中，不会上传，不会请求远程服务器。
