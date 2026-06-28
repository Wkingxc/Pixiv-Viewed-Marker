// 作者/作品页增强引导脚本：路由调度 + 各种 watcher + start
(function initAuthorBootstrap(global) {
  const PVM = global.PVM = global.PVM || {};
  const author = PVM.author = PVM.author || {};

  async function loadPanelForCurrentRoute() {
    const routeContext = author.getRouteContext();
    author.setCurrentRouteContext(routeContext);
    if (!routeContext) {
      author.setCurrentArtworkId(null);
      const panel = author.artworkPanel?.getPanel?.();
      if (panel) panel.hidden = true;
      author.authorPage?.clearUserArtworkPageEnhancements();
      author.artworkSections?.clear?.();
      return;
    }

    const routeKey = routeContext.type === "artwork"
      ? `artwork:${routeContext.artworkId}`
      : `userArtworks:${routeContext.userId}`;
    const previousRouteKey = author.getState().routeKey;
    if (routeKey === previousRouteKey && author.getState().ids.length) {
      await author.artworkPanel.renderPanel();
      author.authorPage?.scheduleUserArtworkEnhancements(0);
      author.artworkSections?.scheduleApply?.(0);
      return;
    }

    author.setCurrentArtworkId(routeContext.type === "artwork" ? routeContext.artworkId : null);
    if (routeContext.type !== "userArtworks") {
      // 切换 artwork 路由时清除上一个作者页的高清/网格副作用
      author.authorPage?.clearUserArtworkPageEnhancements();
    }
    if (routeContext.type !== "artwork") {
      // 离开作品页时去掉作者横幅/评论区的隐藏 class
      author.artworkSections?.clear?.();
    }
    author.setState({
      ids: [],
      workMap: {},
      userId: routeContext.type === "userArtworks" ? routeContext.userId : null,
      userName: "",
      page: 0,
      loading: true,
      error: "",
      routeKey,
      currentBookmark: null
    });
    await author.artworkPanel.renderPanel();

    try {
      const payload = routeContext.type === "artwork"
        ? await author.fetchAuthorWorksForArtwork(routeContext.artworkId)
        : await author.fetchAuthorWorksByUserId(routeContext.userId);
      author.setState({
        ids: payload.ids || [],
        workMap: payload.workMap || {},
        userId: payload.userId,
        userName: payload.userName || "",
        page: routeContext.type === "artwork" ? author.currentPageFor(payload.ids || [], routeContext.artworkId) : 0,
        loading: false,
        error: "",
        routeKey,
        currentBookmark: routeContext.type === "artwork"
          ? { artworkId: routeContext.artworkId, bookmarkId: payload.bookmarkId || "" }
          : null
      });
    } catch (error) {
      const fallback = author.fallbackWorksFromDom();
      author.setState({
        ids: fallback.ids,
        workMap: fallback.workMap,
        userId: routeContext.type === "userArtworks" ? routeContext.userId : null,
        userName: "",
        page: routeContext.type === "artwork" ? author.currentPageFor(fallback.ids, routeContext.artworkId) : 0,
        loading: false,
        error: fallback.ids.length ? "" : "作者作品加载失败",
        routeKey,
        currentBookmark: null
      });
    }

    await author.artworkPanel.renderPanel();
    author.authorPage?.scheduleUserArtworkEnhancements(0);
    author.artworkSections?.scheduleApply?.(0);
  }

  function watchRoute() {
    let href = location.href;
    window.setInterval(() => {
      if (href === location.href) return;
      href = location.href;
      loadPanelForCurrentRoute().catch(console.error);
    }, 500);
  }

  function watchDom() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.target?.parentElement?.closest?.("#pvm-author-hover-preview")) continue;
        if (Array.from(mutation.addedNodes).some((node) => node.id === "pvm-author-hover-preview" || node.closest?.("#pvm-author-hover-preview"))) continue;
        if (mutation.addedNodes.length > 0 || mutation.type === "characterData") {
          author.authorPage?.scheduleUserArtworkEnhancements();
          author.artworkSections?.scheduleApply?.();
          return;
        }
      }
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  }

  function watchStorage() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (changes.settings) {
        author.setSettings(author.normalizeAuthorSettings(changes.settings.newValue));
        author.authorPage?.scheduleUserArtworkEnhancements(0);
        author.artworkSections?.scheduleApply?.(0);
      }
      if (changes.viewedArtworks || changes.settings) {
        author.artworkPanel.renderPanel().catch(console.error);
      }
    });
  }

  function watchWindow() {
    window.addEventListener("scroll", () => author.hover?.hideHoverPreview(), true);
    window.addEventListener("resize", () => {
      author.hover?.hideHoverPreview();
      author.artworkPanel.applyPanelUi();
      author.authorPage?.scheduleUserArtworkEnhancements(0);
    });
  }

  async function start() {
    await author.loadUiState();
    await author.loadSettings();
    await loadPanelForCurrentRoute();
    watchRoute();
    watchDom();
    watchStorage();
    watchWindow();
  }

  start().catch(console.error);
})(globalThis);
