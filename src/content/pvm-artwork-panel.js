(function initArtworkPanel(global) {
  const PVM = global.PVM = global.PVM || {};
  const author = PVM.author = PVM.author || {};
  const artworkPanel = author.artworkPanel = author.artworkPanel || {};

  let panel = null;
  let wheelPagingLocked = false;

  const LAYOUT_HOST_CLASS = "pvm-artwork-layout-host";
  const SIDE_RAIL_CLASS = "pvm-artwork-side-rail";
  let markedLayoutHost = null;
  let markedSideRail = null;

  // --- 面板挂载 -----------------------------------------------------------
  function queryAll(root, selector) {
    try { return Array.from(root?.querySelectorAll?.(selector) || []); }
    catch (_) { return []; }
  }

  function uniqueNodes(nodes) {
    return Array.from(new Set(nodes.filter(Boolean)));
  }

  function isPanelNode(node) {
    return node?.id === "pvm-author-panel" || Boolean(node?.closest?.("#pvm-author-panel"));
  }

  function countArtworkLinks(node) {
    return queryAll(node, 'a[href*="/artworks/"]').filter((anchor) => !isPanelNode(anchor)).length;
  }

  function isDocumentShell(node) {
    const name = node?.localName || node?.tagName?.toLowerCase?.() || "";
    return name === "html" || name === "body" || name === "main";
  }

  function isLikelyPixivRightRail(node) {
    if (!node || isPanelNode(node)) return false;
    const name = node.localName || node.tagName?.toLowerCase?.() || "";
    if (name !== "aside") return false;
    let sibling = node.parentElement?.firstElementChild;
    while (sibling) {
      const siblingName = sibling.localName || sibling.tagName?.toLowerCase?.() || "";
      if (siblingName === "main") return true;
      sibling = sibling.nextElementSibling;
    }
    const siblings = Array.from(node.parentElement?.children || []);
    return siblings.some((child) => (child.localName || child.tagName?.toLowerCase?.() || "") === "main");
  }

  function isUsableEmbedHost(node) {
    if (!node || isPanelNode(node) || isDocumentShell(node)) return false;
    return countArtworkLinks(node) >= 2 || isLikelyPixivRightRail(node);
  }

  function findSemanticHost(root = document) {
    const candidates = uniqueNodes([
      ...queryAll(root, "aside"),
      ...queryAll(root, '[role="complementary"]')
    ]).filter(isUsableEmbedHost);
    candidates.sort((a, b) => {
      const aIsRail = isLikelyPixivRightRail(a);
      const bIsRail = isLikelyPixivRightRail(b);
      if (aIsRail !== bIsRail) return aIsRail ? -1 : 1;
      return countArtworkLinks(b) - countArtworkLinks(a);
    });
    return candidates[0] || null;
  }

  function findEmbedHost(root = document) {
    const semantic = findSemanticHost(root);
    if (semantic) return { host: semantic, mode: "right-rail" };
    return null;
  }

  function markLayoutHost(host, mode) {
    clearLayoutMarks();
    if (mode !== "right-rail" || !host?.parentElement) return;
    markedLayoutHost = host.parentElement;
    markedSideRail = host;
    markedLayoutHost.classList.add(LAYOUT_HOST_CLASS);
    markedSideRail.classList.add(SIDE_RAIL_CLASS);
  }

  function clearLayoutMarks() {
    markedLayoutHost?.classList?.remove?.(LAYOUT_HOST_CLASS);
    markedSideRail?.classList?.remove?.(SIDE_RAIL_CLASS);
    markedLayoutHost = null;
    markedSideRail = null;
  }

  function placePanel(host, mode) {
    if (!panel || !host) return;
    if (panel.parentElement !== host) {
      if (typeof host.prepend === "function") host.prepend(panel);
      else host.insertBefore?.(panel, host.firstChild || null);
    } else if (host.firstElementChild && host.firstElementChild !== panel) {
      host.insertBefore?.(panel, host.firstElementChild);
    }
    panel.dataset.mountMode = mode;
    panel.classList.add("is-embedded");
    markLayoutHost(host, mode);
  }

  // 等待 Pixiv 右栏出现。每 100ms 找一次，最多 10 秒。
  // 这是整个面板的入口：右栏没就绪就不渲染，更不预加载图片。
  function waitForEmbedHost() {
    return new Promise((resolve) => {
      const immediate = findEmbedHost(document);
      if (immediate?.host) { resolve(immediate); return; }
      let ticks = 0;
      const timer = setInterval(() => {
        ticks += 1;
        const found = findEmbedHost(document);
        if (found?.host || ticks >= 100) {
          clearInterval(timer);
          resolve(found);
        }
      }, 100);
    });
  }

  function remountPanelForCurrentRoute() {
    if (!panel) return findEmbedHost(document);
    const routeContext = author.getCurrentRouteContext();
    if (routeContext?.type !== "artwork") {
      clearLayoutMarks();
      return null;
    }
    const target = findEmbedHost(document);
    if (target?.host) {
      placePanel(target.host, target.mode);
      return target;
    }
    return null;
  }

  function applyPanelUi() {
    if (!panel) return;
    const uiState = author.getUiState();
    const offset = Number.isFinite(uiState.offsetX) ? uiState.offsetX : 0;
    panel.style.setProperty("--pvm-ap-offset-x", `${offset}px`);
  }

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement("aside");
    panel.id = "pvm-author-panel";
    panel.classList.add("is-embedded");
    applyPanelUi();
    panel.addEventListener("wheel", handlePanelWheel, { passive: false });
    return panel;
  }

  function getTotalPages() {
    return Math.max(1, Math.ceil(author.getState().ids.length / author.PAGE_SIZE));
  }

  // --- 渲染各部件 ---------------------------------------------------------
  function renderPageModeButton() {
    const isWheelMode = author.getUiState().pageMode === "wheel";
    return `
      <button
        class="pvm-ap-btn pvm-ap-mode-btn ${isWheelMode ? "is-active" : ""}"
        data-action="toggle-page-mode"
        type="button"
        aria-pressed="${isWheelMode ? "true" : "false"}"
        title="${isWheelMode ? "当前为翻页" : "当前为滚动"}"
      >${isWheelMode ? "翻页" : "滚动"}</button>
    `;
  }

  function renderFooter(totalPages) {
    const showCurrentButton = author.getCurrentRouteContext()?.type === "artwork";
    const state = author.getState();
    const uiState = author.getUiState();
    if (uiState.pageMode === "wheel") {
      return `
        <div class="pvm-ap-footer pvm-ap-footer-wheel">
          ${showCurrentButton ? '<button class="pvm-ap-btn" data-action="current" type="button">定位</button>' : ""}
          <span class="pvm-ap-wheel-hint">翻页 · ${state.page + 1} / ${totalPages}</span>
        </div>
      `;
    }
    // 滚动模式：底部只显示作品总数和"定位"按钮，翻页交给滚动条
    return `
      <div class="pvm-ap-footer pvm-ap-footer-scroll">
        ${showCurrentButton ? '<button class="pvm-ap-btn" data-action="current" type="button">定位</button>' : ""}
        <span class="pvm-ap-page">共 ${state.ids.length} 件</span>
      </div>
    `;
  }

  function renderMessage(message) {
    const target = ensurePanel();
    applyPanelUi();
    target.innerHTML = `
      <div class="pvm-ap-head" data-drag-handle="true">
        <span class="pvm-ap-current">${message}</span>
        <div class="pvm-ap-actions">
          ${renderPageModeButton()}
        </div>
      </div>
      <div class="pvm-ap-message">${message}</div>
    `;
    bindPanelEvents();
    void author.preloadPageDetails(author.getState().page + 1);
  }

  function renderWork(work, viewedSet) {
    const isCurrent = work.id === author.getCurrentArtworkId();
    const isViewed = viewedSet.has(work.id);
    const classes = [
      "pvm-ap-card",
      isCurrent ? "is-current" : "",
      isViewed ? "is-viewed" : ""
    ].filter(Boolean).join(" ");
    const pageCount = Math.max(1, Number(work.pageCount || 1));
    const image = author.pickImage(work) || work.image || "";

    // 翻页和滚动模式统一：直接给 <img src>，让浏览器原生 loading="lazy" 处理按需加载。
    // 不再自制 IntersectionObserver / scroll handler —— 翻页之所以好用就是因为没有这层包装。
    return `
      <a class="${classes}" href="https://www.pixiv.net/artworks/${work.id}" data-artwork-id="${work.id}" title="${author.escapeAttr(work.title)}">
        <span class="pvm-ap-thumb-wrap">
          ${pageCount > 1 ? `<span class="pvm-ap-count">${pageCount}</span>` : ""}
          <img class="pvm-ap-thumb" src="${author.escapeAttr(image)}" alt="" loading="lazy" decoding="async">
        </span>
      </a>
    `;
  }

  // --- 主渲染入口 ---------------------------------------------------------
  async function renderPanel() {
    const routeContext = author.getCurrentRouteContext();
    const isArtwork = routeContext?.type === "artwork";

    if (!isArtwork) {
      if (panel) panel.hidden = true;
      return;
    }

    // 等右栏先就绪再创建面板：这样避免 grid 尺寸 = 0 时去触发图片预加载。
    // 已挂载到右栏则直接复用，未挂载则轮询等待（最多 10 秒）。
    let embedTarget = findEmbedHost(document);
    if (!embedTarget?.host) {
      embedTarget = await waitForEmbedHost();
    }
    if (!embedTarget?.host) {
      // 右栏 10 秒还没出现就放弃，不挂面板也不预加载，避免脏渲染。
      if (panel) panel.hidden = true;
      return;
    }

    const target = ensurePanel();
    placePanel(embedTarget.host, embedTarget.mode);
    target.hidden = false;
    applyPanelUi();

    const state = author.getState();
    if (state.loading) {
      renderMessage("正在加载作者作品...");
      return;
    }
    if (state.error) {
      renderMessage(state.error);
      return;
    }

    try {
      await author.ensureDetailsForPage(state.page);
    } catch (error) {
      console.warn("[PVM] Failed to load author panel thumbnails.", error);
    }
    const viewedSet = await author.getViewedSet();
    const totalPages = getTotalPages();
    state.page = Math.min(Math.max(0, state.page), totalPages - 1);
    const isScrollMode = author.getUiState().pageMode !== "wheel";
    // 滚动浏览：一次性渲染所有作品，依靠网格滚动条平滑预览；
    // 滚轮翻页：保持原本按页渲染 6 件的行为。
    const visibleIds = isScrollMode
      ? state.ids.slice()
      : state.ids.slice(state.page * author.PAGE_SIZE, (state.page + 1) * author.PAGE_SIZE);
    const visibleWorks = visibleIds.map((id) => author.workForId(id));
    const currentIndex = state.ids.findIndex((id) => id === author.getCurrentArtworkId());
    const currentText = currentIndex >= 0
      ? `当前位置 ${currentIndex + 1}/${state.ids.length}`
      : `${state.ids.length} 件作品`;

    target.innerHTML = `
      <div class="pvm-ap-head" data-drag-handle="true">
        <span class="pvm-ap-current">${currentText}</span>
        <div class="pvm-ap-actions">
          ${renderPageModeButton()}
        </div>
      </div>
      <div class="pvm-ap-grid ${isScrollMode ? "is-scrollable" : ""}">
        ${visibleWorks.map((work) => renderWork(work, viewedSet)).join("")}
      </div>
      ${renderFooter(totalPages)}
    `;
    bindPanelEvents();
    if (author.authorPage) author.authorPage.scheduleUserArtworkEnhancements();
    if (isScrollMode) {
      // 滚动模式：先把全部作品详情拉到（拿到缩略图 URL），然后浏览器原生 loading="lazy"
      // 会自动只加载视口附近的图片，跟翻页一样不需要任何额外脚本。
      const missingBefore = state.ids.some((id) => !state.workMap[id]);
      if (missingBefore) {
        author.ensureDetailsForIds(state.ids).then(() => {
          // 详情到位后重渲一次，把刚拿到的 URL 填进 <img src>
          renderPanel().catch(console.error);
        }).catch((error) => console.warn("[PVM] ensureDetailsForIds failed.", error));
      }
      alignCurrentCardWhenReady();
    } else {
      // 翻页模式：只预加载当前页前后两页。
      void author.preloadPageDetails(state.page - 1);
      void author.preloadPageDetails(state.page + 1);
      author.preloadImagesForIds(visibleIds);
    }
  }

  // 等右栏 grid 真正拥有非零高度后，把当前作品对齐到视野中央。
  // 用轮询是因为 Pixiv 右栏 hydration 完成的时刻不一定能被 rAF/RO 覆盖到。
  let alignTimer = null;
  function alignCurrentCardWhenReady() {
    if (alignTimer) {
      clearInterval(alignTimer);
      alignTimer = null;
    }
    if (!panel) return;
    let ticks = 0;
    const tick = () => {
      ticks += 1;
      const grid = panel.querySelector(".pvm-ap-grid.is-scrollable");
      const currentId = author.getCurrentArtworkId();
      if (!grid || !currentId) return false;
      const h = grid.clientHeight;
      if (h === 0) return false;
      const card = grid.querySelector(`.pvm-ap-card[data-artwork-id="${currentId}"]`);
      if (!card) return false;
      const target = card.offsetTop - (h - card.offsetHeight) / 2;
      grid.scrollTop = Math.max(0, target);
      return true;
    };
    if (tick()) return;
    alignTimer = setInterval(() => {
      if (tick() || ticks >= 30) {
        clearInterval(alignTimer);
        alignTimer = null;
      }
    }, 200);
  }


  // --- 卡片点击 / 中键 / actions -----------------------------------------
  function bindPanelEvents() {
    if (!panel) return;
    panel.querySelectorAll(".pvm-ap-card").forEach((card) => {
      const navigateInCurrentTab = (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.location.assign(card.href);
      };
      // 左键单击：在 mousedown 阶段先触发 SPA 跳转，避免 Pixiv 懒加载重排吞掉 click。
      card.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        navigateInCurrentTab(event);
      });
      card.addEventListener("click", (event) => {
        if (event.button !== 0) return;
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        navigateInCurrentTab(event);
      });
      // 中键 / Ctrl·Cmd+左键：通过 background 用 chrome.tabs.create 强制后台新标签打开
      const openInBackgroundTab = (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          chrome.runtime.sendMessage({ type: "PVM_OPEN_TAB", url: card.href, active: false });
        } catch (error) {
          window.open(card.href, "_blank", "noopener,noreferrer");
        }
      };
      card.addEventListener("mousedown", (event) => {
        if (event.button === 1) { openInBackgroundTab(event); return; }
        if (event.button === 0 && (event.ctrlKey || event.metaKey)) openInBackgroundTab(event);
      });
      card.addEventListener("auxclick", (event) => {
        if (event.button === 1) openInBackgroundTab(event);
      });
    });

    panel.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const action = button.dataset.action;
        const state = author.getState();
        const uiState = author.getUiState();
        if (action === "current") {
          if (uiState.pageMode === "wheel") {
            state.page = author.currentPageFor(state.ids, author.getCurrentArtworkId());
          } else {
            // 滚动模式：把当前作品卡片滚到面板可视区
            scrollCurrentCardIntoView();
            return;
          }
        }
        if (action === "toggle-page-mode") {
          author.patchUiState({
            pageMode: uiState.pageMode === "wheel" ? "scroll" : "wheel"
          });
          author.saveUiState();
          await renderPanel();
          return;
        }
        await renderPanel();
      });
    });
  }

  function scrollCurrentCardIntoView(options = {}) {
    if (!panel) return;
    const currentId = author.getCurrentArtworkId();
    if (!currentId) return;
    const card = panel.querySelector(`.pvm-ap-card[data-artwork-id="${currentId}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: options.smooth === false ? "auto" : "smooth", block: "center" });
  }

  function handlePanelWheel(event) {
    if (author.getUiState().pageMode !== "wheel") return;
    if (panel.hidden) return;
    if (Math.abs(event.deltaY) < 20) return;

    const totalPages = getTotalPages();
    const state = author.getState();
    const direction = event.deltaY > 0 ? 1 : -1;
    const nextPage = Math.min(Math.max(state.page + direction, 0), totalPages - 1);
    event.preventDefault();
    event.stopPropagation();

    if (nextPage === state.page || wheelPagingLocked) return;
    wheelPagingLocked = true;
    state.page = nextPage;
    renderPanel()
      .catch(console.error)
      .finally(() => {
        window.setTimeout(() => { wheelPagingLocked = false; }, 220);
      });
  }

  artworkPanel.renderPanel = renderPanel;
  artworkPanel.applyPanelUi = applyPanelUi;
  artworkPanel.remountPanelForCurrentRoute = remountPanelForCurrentRoute;
  artworkPanel.findEmbedHost = findEmbedHost;
  artworkPanel.getPanel = () => panel;
})(globalThis);
