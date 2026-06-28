(function initArtworkPanel(global) {
  const PVM = global.PVM = global.PVM || {};
  const author = PVM.author = PVM.author || {};
  const artworkPanel = author.artworkPanel = author.artworkPanel || {};

  let panel = null;
  let toggle = null;
  let wheelPagingLocked = false;

  const LAYOUT_HOST_CLASS = "pvm-artwork-layout-host";
  const SIDE_RAIL_CLASS = "pvm-artwork-side-rail";
  let markedLayoutHost = null;
  let markedSideRail = null;

  // 常驻入口图标：粉色圆形 + 画廊缩略图 SVG
  const TOGGLE_ICON_SVG = `<svg class="pvm-ap-toggle-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="6.5" y="4.5" width="13" height="13" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.55"/>
    <rect x="3.5" y="7.5" width="13" height="13" rx="2.4" fill="currentColor"/>
    <circle cx="7" cy="11.5" r="1.3" fill="rgba(255,255,255,0.92)"/>
    <path d="M5 17 L9 13 L12 16 L14.5 14 L15 17 Z" fill="rgba(255,255,255,0.92)"/>
  </svg>`;

  // --- 面板挂载 / 缩放 / 偏移 --------------------------------------------
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
    panel.classList.remove("is-fixed-fallback");
    markLayoutHost(host, mode);
  }

  function placeFixedFallback() {
    if (!panel) return;
    clearLayoutMarks();
    if (panel.parentElement !== document.documentElement) document.documentElement.append(panel);
    panel.dataset.mountMode = "fixed-fallback";
    panel.classList.remove("is-embedded");
    panel.classList.add("is-fixed-fallback");
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
    placeFixedFallback();
    return null;
  }

  function isEmbeddedPanel() {
    return Boolean(panel?.classList?.contains("is-embedded"));
  }

  function applyPanelUi() {
    if (!panel) return;
    const uiState = author.getUiState();
    panel.style.setProperty("--pvm-ap-scale", String(author.SCALE_STEPS[uiState.scaleIndex]));
    const offset = Number.isFinite(uiState.offsetX) ? uiState.offsetX : 0;
    panel.style.setProperty("--pvm-ap-offset-x", `${offset}px`);
  }

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement("aside");
    panel.id = "pvm-author-panel";
    document.documentElement.append(panel);
    applyPanelUi();
    remountPanelForCurrentRoute();
    panel.addEventListener("wheel", handlePanelWheel, { passive: false });
    return panel;
  }

  function ensureToggle() {
    if (toggle) return toggle;
    toggle = document.createElement("button");
    toggle.id = "pvm-author-toggle";
    toggle.type = "button";
    toggle.innerHTML = TOGGLE_ICON_SVG;
    toggle.setAttribute("aria-label", "打开作者作品速览");
    toggle.setAttribute("title", "打开作者作品速览");
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setPanelExpanded(!isExpanded());
    });
    document.documentElement.append(toggle);
    return toggle;
  }

  function isExpanded() {
    return author.getUiState().authorPanelExpanded === true;
  }

  function setPanelExpanded(expanded) {
    author.patchUiState({ authorPanelExpanded: Boolean(expanded) });
    author.saveUiState();
    renderPanel().catch(console.error);
  }

  function getTotalPages() {
    return Math.max(1, Math.ceil(author.getState().ids.length / author.PAGE_SIZE));
  }

  // --- 渲染各部件 ---------------------------------------------------------
  function renderScaleControls() {
    const uiState = author.getUiState();
    const scale = author.SCALE_STEPS[uiState.scaleIndex];
    return `
      <button class="pvm-ap-btn pvm-ap-icon-btn" data-action="scale-down" type="button" ${uiState.scaleIndex === 0 ? "disabled" : ""} title="缩小面板" aria-label="缩小面板">-</button>
      <span class="pvm-ap-scale-label">${Math.round(scale * 100)}%</span>
      <button class="pvm-ap-btn pvm-ap-icon-btn" data-action="scale-up" type="button" ${uiState.scaleIndex >= author.SCALE_STEPS.length - 1 ? "disabled" : ""} title="放大面板" aria-label="放大面板">+</button>
    `;
  }

  function renderPageModeButton() {
    const isWheelMode = author.getUiState().pageMode === "wheel";
    return `
      <button
        class="pvm-ap-btn pvm-ap-mode-btn ${isWheelMode ? "is-active" : ""}"
        data-action="toggle-page-mode"
        type="button"
        aria-pressed="${isWheelMode ? "true" : "false"}"
        title="${isWheelMode ? "当前为滚轮翻页" : "当前为滑动翻页"}"
      >${isWheelMode ? "滚轮翻页" : "滑动翻页"}</button>
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
          <span class="pvm-ap-wheel-hint">滚轮翻页 · ${state.page + 1} / ${totalPages}</span>
        </div>
      `;
    }
    return `
      <div class="pvm-ap-footer pvm-ap-footer-slider">
        <div class="pvm-ap-footer-left">
          ${showCurrentButton ? '<button class="pvm-ap-btn" data-action="current" type="button">定位</button>' : ""}
          <span class="pvm-ap-page">${state.page + 1} / ${totalPages}</span>
        </div>
        <div class="pvm-ap-slider-row">
          <input class="pvm-ap-page-slider" data-action="page-slider" type="range" min="1" max="${totalPages}" value="${state.page + 1}" aria-label="滑动翻页">
        </div>
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
          ${renderScaleControls()}
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

    return `
      <a class="${classes}" href="https://www.pixiv.net/artworks/${work.id}" data-artwork-id="${work.id}" title="${author.escapeAttr(work.title)}">
        <span class="pvm-ap-thumb-wrap">
          ${pageCount > 1 ? `<span class="pvm-ap-count">${pageCount}</span>` : ""}
          <img class="pvm-ap-thumb" src="${author.escapeAttr(image)}" alt="" loading="lazy">
        </span>
      </a>
    `;
  }

  // --- 主渲染入口 ---------------------------------------------------------
  async function renderPanel() {
    const routeContext = author.getCurrentRouteContext();
    const isArtwork = routeContext?.type === "artwork";

    // 常驻图标只在作品页显示；离开作品页一并隐藏
    if (toggle) toggle.hidden = !isArtwork;
    if (isArtwork) ensureToggle();

    if (!isArtwork) {
      if (panel) panel.hidden = true;
      return;
    }

    // 嵌入模式是页面内容的一部分，不再依赖左下角悬浮入口。
    const embedTarget = findEmbedHost(document);
    if (embedTarget?.host && !isExpanded()) {
      const target = ensurePanel();
      placePanel(embedTarget.host, embedTarget.mode);
      target.hidden = false;
      updateToggleState(false);
      if (toggle) toggle.hidden = true;
      applyPanelUi();
    } else if (!isExpanded()) {
      if (panel) panel.hidden = true;
      updateToggleState(false);
      return;
    } else {
      updateToggleState(true);
      const target = ensurePanel();
      remountPanelForCurrentRoute();
      target.hidden = false;
      applyPanelUi();
    }

    const target = panel;

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
    const visibleIds = state.ids.slice(state.page * author.PAGE_SIZE, (state.page + 1) * author.PAGE_SIZE);
    const visibleWorks = visibleIds.map((id) => author.workForId(id));
    const currentIndex = state.ids.findIndex((id) => id === author.getCurrentArtworkId());
    const currentText = currentIndex >= 0
      ? `当前位置 ${currentIndex + 1}/${state.ids.length}`
      : `${state.ids.length} 件作品`;

    target.innerHTML = `
      <div class="pvm-ap-head" data-drag-handle="true">
        <span class="pvm-ap-current">${currentText}</span>
        <div class="pvm-ap-actions">
          ${renderScaleControls()}
          ${renderPageModeButton()}
        </div>
      </div>
      <div class="pvm-ap-grid">
        ${visibleWorks.map((work) => renderWork(work, viewedSet)).join("")}
      </div>
      ${renderFooter(totalPages)}
    `;
    bindPanelEvents();
    if (author.authorPage) author.authorPage.scheduleUserArtworkEnhancements();
    // 预加载当前页的前一页和后一页：先拉详情，再触发浏览器图片预解码
    void author.preloadPageDetails(state.page - 1);
    void author.preloadPageDetails(state.page + 1);
    author.preloadImagesForIds(visibleIds);
  }

  function updateToggleState(expanded) {
    if (!toggle) return;
    toggle.classList.toggle("is-active", Boolean(expanded));
    toggle.setAttribute("aria-label", expanded ? "收起作者作品速览" : "打开作者作品速览");
    toggle.setAttribute("title", expanded ? "收起作者作品速览" : "打开作者作品速览");
  }

  // --- 横向拖动（仅左右） -------------------------------------------------
  function bindHorizontalDrag() {
    if (isEmbeddedPanel()) return;
    const handle = panel.querySelector(".pvm-ap-current");
    if (!handle || handle.dataset.pvmDragBound === "true") return;
    handle.dataset.pvmDragBound = "true";
    handle.style.cursor = "ew-resize";

    let dragging = null;

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      dragging = {
        pointerId: event.pointerId,
        startX: event.clientX,
        baseOffset: Number.isFinite(author.getUiState().offsetX) ? author.getUiState().offsetX : 0
      };
      handle.setPointerCapture?.(event.pointerId);
      panel.classList.add("is-dragging");
      event.preventDefault();
    });

    handle.addEventListener("pointermove", (event) => {
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      const deltaX = event.clientX - dragging.startX;
      const rawOffset = dragging.baseOffset + deltaX;
      const panelWidth = panel.offsetWidth || 0;
      const maxRight = 20;
      const maxLeft = -(window.innerWidth - panelWidth - 40);
      const clamped = Math.min(Math.max(rawOffset, maxLeft), maxRight);
      author.patchUiState({ offsetX: clamped });
      applyPanelUi();
    });

    const finish = (event) => {
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      handle.releasePointerCapture?.(event.pointerId);
      panel.classList.remove("is-dragging");
      dragging = null;
      author.saveUiState();
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  // --- 卡片点击 / 中键 / actions -----------------------------------------
  function bindPanelEvents() {
    if (!panel) return;
    bindHorizontalDrag();
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

    panel.querySelectorAll('[data-action="page-slider"]').forEach((slider) => {
      const updateFromSlider = async (event) => {
        const totalPages = getTotalPages();
        const nextPage = Math.min(Math.max(Number(event.target.value || 1) - 1, 0), totalPages - 1);
        const state = author.getState();
        if (state.page === nextPage) return;
        state.page = nextPage;
        await renderPanel();
      };
      slider.addEventListener("input", updateFromSlider);
      slider.addEventListener("change", updateFromSlider);
    });

    panel.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const action = button.dataset.action;
        const state = author.getState();
        if (action === "current") state.page = author.currentPageFor(state.ids, author.getCurrentArtworkId());
        if (action === "scale-down" || action === "scale-up") {
          const direction = action === "scale-up" ? 1 : -1;
          const uiState = author.getUiState();
          author.patchUiState({
            scaleIndex: Math.min(Math.max(uiState.scaleIndex + direction, 0), author.SCALE_STEPS.length - 1)
          });
          applyPanelUi();
          author.saveUiState();
          const nextUi = author.getUiState();
          const label = panel.querySelector(".pvm-ap-scale-label");
          if (label) label.textContent = `${Math.round(author.SCALE_STEPS[nextUi.scaleIndex] * 100)}%`;
          const downBtn = panel.querySelector('[data-action="scale-down"]');
          const upBtn = panel.querySelector('[data-action="scale-up"]');
          if (downBtn) downBtn.disabled = nextUi.scaleIndex === 0;
          if (upBtn) upBtn.disabled = nextUi.scaleIndex >= author.SCALE_STEPS.length - 1;
          return;
        }
        if (action === "toggle-page-mode") {
          author.patchUiState({
            pageMode: author.getUiState().pageMode === "wheel" ? "slider" : "wheel"
          });
          author.saveUiState();
          await renderPanel();
          return;
        }
        await renderPanel();
      });
    });
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
  artworkPanel.setPanelExpanded = setPanelExpanded;
  artworkPanel.getPanel = () => panel;
  artworkPanel.getToggle = () => toggle;
})(globalThis);
