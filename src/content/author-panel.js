(function initAuthorPanel(global) {
  const PVM = global.PVM || {};
  const PAGE_SIZE = 6;
  const CACHE_TTL = 30 * 60 * 1000;
  const UI_STORAGE_KEY = "pvmAuthorPanelUi";
  const SCALE_STEPS = [1, 1.2, 1.4];
  const HOME_GRID_MIN_COLUMNS = 2;
  const HOME_GRID_MAX_COLUMNS = 6;
  const HOME_MIN_PAGE_MAX = 999;
  const HOME_GRID_CLASS = "pvm-author-home-grid";
  const HOME_HIDDEN_CLASS = "pvm-hidden-page-count-artwork";
  const HOME_TOOLBAR_MIN_WIDTH = 132;
  const HOME_TOOLBAR_MAX_WIDTH = 260;

  let panel = null;
  let homeToolbar = null;
  let currentArtworkId = null;
  let currentRouteContext = null;
  let dragState = null;
  let suppressNextClick = false;
  let wheelPagingLocked = false;
  let enhancementTimer = null;
  let applyingEnhancements = false;
  let state = {
    ids: [],
    workMap: {},
    userId: null,
    userName: "",
    page: 0,
    loading: false,
    error: ""
  };
  let uiState = {
    left: null,
    top: null,
    scaleIndex: 0,
    pageMode: "buttons",
    homeGridColumns: 6,
    homeMinPageCount: 0,
    authorPanelExpanded: false,
    homeToolbarWidth: 176,
    homeToolbarLeft: null,
    homeToolbarTop: null
  };

  function stripLocale(pathname) {
    return pathname.replace(/^\/(?:en|ja|zh|ko|zh-tw|zh-cn)(?=\/|$)/i, "") || "/";
  }

  function getRouteContext() {
    const parsed = PVM.parsePixivUrl(location.href);
    if (parsed?.type === "artwork") return { type: "artwork", artworkId: parsed.id };

    const match = stripLocale(location.pathname).match(/^\/users\/(\d+)(?:\/(?:artworks|illustrations|manga))?(?:\/.*)?\/?$/);
    if (match) return { type: "userArtworks", userId: match[1] };

    return null;
  }

  async function fetchJson(path) {
    const response = await fetch(path, {
      credentials: "include",
      headers: {
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest"
      }
    });
    if (!response.ok) throw new Error(`Pixiv request failed: ${response.status}`);
    const json = await response.json();
    if (json.error) throw new Error(json.message || "Pixiv API returned an error.");
    return json.body;
  }

  function pickImage(work) {
    return (
      work.urls?.thumb_mini ||
      work.urls?.small ||
      work.url ||
      work.urls?.regular ||
      work.urls?.original ||
      work.thumbnail ||
      work.thumbnailUrl ||
      ""
    );
  }

  function normalizeWork(work, id) {
    return {
      id: String(work.id || id),
      title: work.title || "Untitled",
      image: pickImage(work),
      pageCount: Number(work.pageCount || work.page_count || 1),
      createDate: work.createDate || work.create_date || "",
      xRestrict: Number(work.xRestrict || work.x_restrict || 0)
    };
  }

  function sortIds(ids) {
    return ids.sort((a, b) => Number(b) - Number(a));
  }

  function sortWorks(works) {
    return works.sort((a, b) => {
      const dateA = Date.parse(a.createDate || "");
      const dateB = Date.parse(b.createDate || "");
      if (!Number.isNaN(dateA) && !Number.isNaN(dateB) && dateA !== dateB) {
        return dateB - dateA;
      }
      return Number(b.id) - Number(a.id);
    });
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(Math.max(Math.round(number), min), max);
  }

  function normalizeUiState(raw) {
    const scaleIndex = Number.isInteger(raw?.scaleIndex)
      ? Math.min(Math.max(raw.scaleIndex, 0), SCALE_STEPS.length - 1)
      : 0;
    const pageMode = raw?.pageMode === "wheel" ? "wheel" : "buttons";
    return {
      left: Number.isFinite(raw?.left) ? raw.left : null,
      top: Number.isFinite(raw?.top) ? raw.top : null,
      scaleIndex,
      pageMode,
      homeGridColumns: clampNumber(raw?.homeGridColumns, HOME_GRID_MIN_COLUMNS, HOME_GRID_MAX_COLUMNS, 6),
      homeMinPageCount: clampNumber(raw?.homeMinPageCount, 0, HOME_MIN_PAGE_MAX, 0),
      authorPanelExpanded: raw?.authorPanelExpanded === true,
      homeToolbarWidth: clampNumber(raw?.homeToolbarWidth, HOME_TOOLBAR_MIN_WIDTH, HOME_TOOLBAR_MAX_WIDTH, 176),
      homeToolbarLeft: Number.isFinite(raw?.homeToolbarLeft) ? raw.homeToolbarLeft : null,
      homeToolbarTop: Number.isFinite(raw?.homeToolbarTop) ? raw.homeToolbarTop : null
    };
  }

  async function loadUiState() {
    try {
      const data = await chrome.storage.local.get(UI_STORAGE_KEY);
      uiState = normalizeUiState(data[UI_STORAGE_KEY]);
    } catch (error) {
      console.warn("[PVM] Failed to load author panel UI state.", error);
    }
  }

  function saveUiState() {
    chrome.storage.local.set({ [UI_STORAGE_KEY]: uiState }).catch((error) => {
      console.warn("[PVM] Failed to save author panel UI state.", error);
    });
  }

  function getTotalPages() {
    return Math.max(1, Math.ceil(state.ids.length / PAGE_SIZE));
  }

  function clampElementPosition(element, left, top) {
    const margin = 8;
    const width = element?.offsetWidth || 48;
    const height = element?.offsetHeight || 48;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    return {
      left: Math.min(Math.max(left, margin), maxLeft),
      top: Math.min(Math.max(top, margin), maxTop)
    };
  }

  function clampPanelPosition(left, top) {
    return clampElementPosition(panel, left, top);
  }

  function applyPanelUi(persistClamp = false) {
    if (!panel) return;

    panel.style.setProperty("--pvm-ap-scale", String(SCALE_STEPS[uiState.scaleIndex]));

    if (Number.isFinite(uiState.left) && Number.isFinite(uiState.top)) {
      const next = clampPanelPosition(uiState.left, uiState.top);
      panel.style.left = `${next.left}px`;
      panel.style.top = `${next.top}px`;
      panel.style.right = "auto";
      if (next.left !== uiState.left || next.top !== uiState.top) {
        uiState = { ...uiState, ...next };
        if (persistClamp) saveUiState();
      }
      return;
    }

    panel.style.left = "auto";
    panel.style.top = "84px";
    panel.style.right = "24px";
  }

  function getDefaultHomeToolbarTop() {
    const panelHeight = panel && !panel.hidden ? panel.offsetHeight : 0;
    return 84 + panelHeight + 12;
  }

  function stackHomeToolbarBelowPanel() {
    if (!homeToolbar) return;
    homeToolbar.style.left = "auto";
    homeToolbar.style.top = `${getDefaultHomeToolbarTop()}px`;
    homeToolbar.style.right = "24px";
  }

  function resetHomeToolbarPositionIfOverlappingPanel() {
    if (!homeToolbar || !panel || panel.hidden || homeToolbar.hidden) return;
    if (!Number.isFinite(uiState.homeToolbarLeft) || !Number.isFinite(uiState.homeToolbarTop)) return;

    const panelRect = panel.getBoundingClientRect();
    const toolbarRect = homeToolbar.getBoundingClientRect();
    const overlaps = !(
      toolbarRect.left >= panelRect.right ||
      toolbarRect.right <= panelRect.left ||
      toolbarRect.top >= panelRect.bottom ||
      toolbarRect.bottom <= panelRect.top
    );
    if (!overlaps) return;

    uiState = { ...uiState, homeToolbarLeft: null, homeToolbarTop: null };
    saveUiState();
    stackHomeToolbarBelowPanel();
  }

  async function getCache(userId) {
    const key = `pvmAuthorPanel:${userId}`;
    const data = await chrome.storage.local.get(key);
    const cached = data[key];
    if (!cached || Date.now() - cached.cachedAt > CACHE_TTL) return null;
    return cached;
  }

  async function setCache(userId, payload) {
    await chrome.storage.local.set({
      [`pvmAuthorPanel:${userId}`]: {
        ...payload,
        cachedAt: Date.now()
      }
    });
  }

  function chunk(items, size) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  async function fetchCurrentArtwork(artworkId) {
    const body = await fetchJson(`/ajax/illust/${artworkId}`);
    return {
      userId: String(body.userId || body.user_id || ""),
      userName: body.userName || body.user_name || ""
    };
  }

  async function fetchAuthorWorkIds(userId) {
    const body = await fetchJson(`/ajax/user/${userId}/profile/all`);
    const illustIds = Object.keys(body.illusts || {});
    const mangaIds = Object.keys(body.manga || {});
    return sortIds(Array.from(new Set([...illustIds, ...mangaIds])));
  }

  async function fetchWorkDetails(userId, ids) {
    const workMap = {};
    for (const idsChunk of chunk(ids, 48)) {
      const params = new URLSearchParams({
        work_category: "illustManga",
        is_first_page: "1"
      });
      idsChunk.forEach((id) => params.append("ids[]", id));
      const body = await fetchJson(`/ajax/user/${userId}/profile/illusts?${params.toString()}`);
      const rawWorks = body.works || body.illusts || body;
      Object.entries(rawWorks).forEach(([id, work]) => {
        if (work && typeof work === "object") workMap[id] = normalizeWork(work, id);
      });
    }
    return workMap;
  }

  async function fetchAuthorWorksByUserId(userId, userName = "") {
    const cached = await getCache(userId);
    if (cached?.ids?.length) {
      return { ...cached, userId, userName: userName || cached.userName || "" };
    }

    const ids = await fetchAuthorWorkIds(userId);
    const payload = {
      userId,
      userName,
      ids,
      workMap: {}
    };
    await setCache(userId, payload);
    return payload;
  }

  async function fetchAuthorWorksForArtwork(artworkId) {
    const current = await fetchCurrentArtwork(artworkId);
    if (!current.userId) throw new Error("Cannot detect author id.");
    return fetchAuthorWorksByUserId(current.userId, current.userName);
  }

  async function ensureDetailsForPage(page) {
    if (!state.userId || state.ids.length === 0) return;
    const ids = state.ids.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const missingIds = ids.filter((id) => !state.workMap[id]);
    if (missingIds.length === 0) return;

    const details = await fetchWorkDetails(state.userId, missingIds);
    state.workMap = { ...state.workMap, ...details };
    await setCache(state.userId, {
      userId: state.userId,
      userName: state.userName,
      ids: state.ids,
      workMap: state.workMap
    });
  }

  async function preloadPageDetails(page) {
    if (!state.userId || state.ids.length === 0) return;
    if (page < 0 || page >= getTotalPages()) return;

    const ids = state.ids.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const missingIds = ids.filter((id) => !state.workMap[id]);
    if (missingIds.length === 0) return;

    try {
      const details = await fetchWorkDetails(state.userId, missingIds);
      state.workMap = { ...state.workMap, ...details };
      await setCache(state.userId, {
        userId: state.userId,
        userName: state.userName,
        ids: state.ids,
        workMap: state.workMap
      });
    } catch (error) {
      console.warn("[PVM] Failed to preload author panel thumbnails.", error);
    }
  }

  function workForId(id) {
    return state.workMap[id] || {
      id,
      title: `Artwork ${id}`,
      image: "",
      pageCount: 1,
      createDate: "",
      xRestrict: 0
    };
  }

  function fallbackWorksFromDom() {
    const anchors = Array.from(document.querySelectorAll('a[href*="/artworks/"]'));
    const seen = new Set();
    const works = anchors
      .map((anchor) => {
        const parsed = PVM.parsePixivUrl(anchor.href);
        if (!parsed || seen.has(parsed.id)) return null;
        seen.add(parsed.id);
        return {
          id: parsed.id,
          title: anchor.textContent?.trim() || `Artwork ${parsed.id}`,
          image: anchor.querySelector("img")?.src || "",
          pageCount: 1,
          createDate: "",
          xRestrict: 0
        };
      })
      .filter(Boolean);
    return {
      ids: works.map((work) => work.id),
      workMap: Object.fromEntries(works.map((work) => [work.id, work]))
    };
  }

  function currentPageFor(ids, artworkId) {
    const index = ids.findIndex((id) => id === artworkId);
    if (index < 0) return 0;
    return Math.floor(index / PAGE_SIZE);
  }

  async function getViewedSet() {
    const data = await PVM.storage.getAllData();
    return new Set(Object.keys(data.viewedArtworks || {}));
  }

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement("aside");
    panel.id = "pvm-author-panel";
    panel.classList.toggle("is-collapsed", !uiState.authorPanelExpanded);
    document.documentElement.append(panel);
    applyPanelUi();
    panel.addEventListener("pointerdown", startPanelDrag);
    panel.addEventListener("wheel", handlePanelWheel, { passive: false });
    return panel;
  }

  function setPanelCollapsed(isCollapsed) {
    if (!panel) return;
    panel.classList.toggle("is-collapsed", Boolean(isCollapsed));
    uiState = { ...uiState, authorPanelExpanded: !isCollapsed };
    saveUiState();
    applyPanelUi(true);

    const button = panel.querySelector('.pvm-ap-collapse-btn[data-action="collapse"]');
    if (!button) return;

    const nextCollapsed = panel.classList.contains("is-collapsed");
    button.setAttribute("aria-label", nextCollapsed ? "展开作者作品速览" : "收起作者作品速览");
    button.setAttribute("title", nextCollapsed ? "展开作者作品速览" : "收起作者作品速览");
    const icon = button.querySelector(".pvm-ap-collapse-icon");
    const label = button.querySelector(".pvm-ap-collapse-label");
    if (icon) icon.textContent = nextCollapsed ? "▦" : "×";
    if (label) label.textContent = nextCollapsed ? "展开" : "收起";
  }

  function renderCollapseButton() {
    const isCollapsed = panel?.classList.contains("is-collapsed");
    return `
      <button
        class="pvm-ap-btn pvm-ap-collapse-btn"
        data-action="collapse"
        type="button"
        aria-label="${isCollapsed ? "展开作者作品速览" : "收起作者作品速览"}"
        title="${isCollapsed ? "展开作者作品速览" : "收起作者作品速览"}"
      >
        <span class="pvm-ap-collapse-icon" aria-hidden="true">${isCollapsed ? "▦" : "×"}</span>
        <span class="pvm-ap-collapse-label">${isCollapsed ? "展开" : "收起"}</span>
      </button>
    `;
  }

  function renderScaleControls() {
    const scale = SCALE_STEPS[uiState.scaleIndex];
    return `
      <button class="pvm-ap-btn pvm-ap-icon-btn" data-action="scale-down" type="button" ${uiState.scaleIndex === 0 ? "disabled" : ""} title="缩小面板" aria-label="缩小面板">-</button>
      <span class="pvm-ap-scale-label">${Math.round(scale * 100)}%</span>
      <button class="pvm-ap-btn pvm-ap-icon-btn" data-action="scale-up" type="button" ${uiState.scaleIndex >= SCALE_STEPS.length - 1 ? "disabled" : ""} title="放大面板" aria-label="放大面板">+</button>
    `;
  }

  function renderPageModeButton() {
    const isWheelMode = uiState.pageMode === "wheel";
    return `
      <button
        class="pvm-ap-btn pvm-ap-mode-btn ${isWheelMode ? "is-active" : ""}"
        data-action="toggle-page-mode"
        type="button"
        aria-pressed="${isWheelMode ? "true" : "false"}"
        title="${isWheelMode ? "当前为滚轮翻页" : "当前为按钮翻页"}"
      >${isWheelMode ? "滚轮翻页" : "按钮翻页"}</button>
    `;
  }

  function renderStepper(action, value, min, max) {
    return `
      <div class="pvm-ap-stepper" data-stepper="${action}">
        <button class="pvm-ap-step-btn" data-action="${action}-down" type="button" ${value <= min ? "disabled" : ""}>−</button>
        <span class="pvm-ap-step-value">${value}</span>
        <button class="pvm-ap-step-btn" data-action="${action}-up" type="button" ${value >= max ? "disabled" : ""}>＋</button>
      </div>
    `;
  }

  function renderHomeControls() {
    return `
      <div class="pvm-ap-home-controls">
        <label class="pvm-ap-field">
          <span>每行</span>
          ${renderStepper("home-columns", uiState.homeGridColumns, HOME_GRID_MIN_COLUMNS, HOME_GRID_MAX_COLUMNS)}
        </label>
        <label class="pvm-ap-field">
          <span>最低页数</span>
          <input class="pvm-ap-input" data-action="home-min-page-count-change" type="number" min="0" max="${HOME_MIN_PAGE_MAX}" step="1" value="${uiState.homeMinPageCount}">
        </label>
      </div>
    `;
  }

  function ensureHomeToolbar() {
    if (homeToolbar) return homeToolbar;
    homeToolbar = document.createElement("aside");
    homeToolbar.id = "pvm-author-home-toolbar";
    document.documentElement.append(homeToolbar);
    homeToolbar.addEventListener("pointerdown", startPanelDrag);
    return homeToolbar;
  }

  function applyHomeToolbarUi(persistClamp = false) {
    if (!homeToolbar) return;

    homeToolbar.style.width = `${uiState.homeToolbarWidth}px`;

    if (Number.isFinite(uiState.homeToolbarLeft) && Number.isFinite(uiState.homeToolbarTop)) {
      const next = clampElementPosition(homeToolbar, uiState.homeToolbarLeft, uiState.homeToolbarTop);
      homeToolbar.style.left = `${next.left}px`;
      homeToolbar.style.top = `${next.top}px`;
      homeToolbar.style.right = "auto";
      if (next.left !== uiState.homeToolbarLeft || next.top !== uiState.homeToolbarTop) {
        uiState = { ...uiState, homeToolbarLeft: next.left, homeToolbarTop: next.top };
        if (persistClamp) saveUiState();
      }
      return;
    }

    homeToolbar.style.left = "auto";
    homeToolbar.style.top = `${getDefaultHomeToolbarTop()}px`;
    homeToolbar.style.right = "24px";
  }

  function hideHomeToolbar() {
    if (homeToolbar) homeToolbar.hidden = true;
  }

  function bindHomeToolbarEvents() {
    if (!homeToolbar) return;
    homeToolbar.querySelectorAll(".pvm-ap-step-btn[data-action]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const action = button.dataset.action;
        if (action === "home-columns-down" || action === "home-columns-up") {
          const direction = action.endsWith("up") ? 1 : -1;
          uiState = {
            ...uiState,
            homeGridColumns: clampNumber(uiState.homeGridColumns + direction, HOME_GRID_MIN_COLUMNS, HOME_GRID_MAX_COLUMNS, 6)
          };
        }
        saveUiState();
        renderHomeToolbar();
        scheduleUserArtworkEnhancements(0);
      });
    });
    homeToolbar.querySelectorAll('.pvm-ap-input[data-action="home-min-page-count-change"]').forEach((input) => {
      const update = () => {
        uiState = {
          ...uiState,
          homeMinPageCount: clampNumber(input.value, 0, HOME_MIN_PAGE_MAX, 0)
        };
        input.value = String(uiState.homeMinPageCount);
        saveUiState();
        scheduleUserArtworkEnhancements(0);
      };
      input.addEventListener("change", update);
      input.addEventListener("blur", update);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") update();
      });
    });
    homeToolbar.querySelectorAll(".pvm-ap-resize-handle").forEach((handle) => {
      handle.addEventListener("pointerdown", startToolbarResize);
    });
  }

  function renderHomeToolbar() {
    if (currentRouteContext?.type !== "userArtworks") {
      hideHomeToolbar();
      return;
    }

    const target = ensureHomeToolbar();
    target.hidden = false;
    applyHomeToolbarUi();
    target.innerHTML = `
      <div class="pvm-ap-head" data-drag-handle="true">
        <span class="pvm-ap-current">作者页显示</span>
      </div>
      ${renderHomeControls()}
      <button class="pvm-ap-resize-handle" data-resize-handle="true" type="button" title="拖动调整宽度" aria-label="拖动调整宽度"></button>
    `;
    bindHomeToolbarEvents();
    resetHomeToolbarPositionIfOverlappingPanel();
  }

  function renderFooter(totalPages) {
    const showCurrentButton = currentRouteContext?.type === "artwork";
    if (uiState.pageMode === "wheel") {
      return `
        <div class="pvm-ap-footer pvm-ap-footer-wheel">
          ${showCurrentButton ? '<button class="pvm-ap-btn" data-action="current" type="button">定位</button>' : ""}
          <span class="pvm-ap-wheel-hint">滚轮翻页 · ${state.page + 1} / ${totalPages}</span>
        </div>
      `;
    }

    return `
      <div class="pvm-ap-footer">
        <div class="pvm-ap-footer-left">
          <button class="pvm-ap-btn" data-action="prev" type="button" ${state.page === 0 ? "disabled" : ""}>上一页</button>
          ${showCurrentButton ? '<button class="pvm-ap-btn" data-action="current" type="button">定位</button>' : ""}
        </div>
        <span class="pvm-ap-page">${state.page + 1} / ${totalPages}</span>
        <button class="pvm-ap-btn" data-action="next" type="button" ${state.page >= totalPages - 1 ? "disabled" : ""}>下一页</button>
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
          ${renderCollapseButton()}
        </div>
      </div>
      <div class="pvm-ap-message">${message}</div>
    `;
    bindPanelEvents();
    void preloadPageDetails(state.page + 1);
  }

  async function renderPanel() {
    if (!currentRouteContext) {
      if (panel) panel.hidden = true;
      return;
    }

    const target = ensurePanel();
    target.hidden = false;
    applyPanelUi();

    if (state.loading) {
      renderMessage("正在加载作者作品...");
      return;
    }

    if (state.error) {
      renderMessage(state.error);
      return;
    }

    try {
      await ensureDetailsForPage(state.page);
    } catch (error) {
      console.warn("[PVM] Failed to load author panel thumbnails.", error);
    }
    const viewedSet = await getViewedSet();
    const totalPages = getTotalPages();
    state.page = Math.min(Math.max(0, state.page), totalPages - 1);
    const visibleWorks = state.ids
      .slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE)
      .map((id) => workForId(id));
    const currentIndex = state.ids.findIndex((id) => id === currentArtworkId);
    const currentText = currentIndex >= 0 ? `当前位置 ${currentIndex + 1}/${state.ids.length}` : `${state.ids.length} 件作品`;

    target.innerHTML = `
      <div class="pvm-ap-head" data-drag-handle="true">
        <span class="pvm-ap-current">${currentText}</span>
        <div class="pvm-ap-actions">
          ${renderScaleControls()}
          ${renderPageModeButton()}
          ${renderCollapseButton()}
        </div>
      </div>
      <div class="pvm-ap-grid">
        ${visibleWorks.map((work) => renderWork(work, viewedSet)).join("")}
      </div>
      ${renderFooter(totalPages)}
    `;
    bindPanelEvents();
    scheduleUserArtworkEnhancements();
  }

  function renderWork(work, viewedSet) {
    const isCurrent = work.id === currentArtworkId;
    const isViewed = viewedSet.has(work.id);
    const classes = [
      "pvm-ap-card",
      isCurrent ? "is-current" : "",
      isViewed ? "is-viewed" : ""
    ].filter(Boolean).join(" ");
    const pageCount = Math.max(1, Number(work.pageCount || 1));

    return `
      <a class="${classes}" href="https://www.pixiv.net/artworks/${work.id}" data-artwork-id="${work.id}" title="${escapeAttr(work.title)}">
        <span class="pvm-ap-thumb-wrap">
          ${pageCount > 1 ? `<span class="pvm-ap-count">${pageCount}</span>` : ""}
          <img class="pvm-ap-thumb" src="${escapeAttr(work.image)}" alt="" loading="lazy">
        </span>
      </a>
    `;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value || "");
  }

  function bindPanelEvents() {
    if (!panel) return;
    panel.querySelectorAll(".pvm-ap-card").forEach((card) => {
      const navigate = (event) => {
        if (event.button && event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        window.location.assign(card.href);
      };
      card.addEventListener("pointerdown", (event) => event.stopPropagation(), true);
      card.addEventListener("pointerup", navigate, true);
      card.addEventListener("click", navigate, true);
      card.addEventListener("auxclick", (event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        event.stopPropagation();
        window.open(card.href, "_blank", "noopener");
      }, true);
    });

    panel.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const action = button.dataset.action;
        if (suppressNextClick && action === "collapse") {
          suppressNextClick = false;
          return;
        }
        if (action === "prev") state.page -= 1;
        if (action === "next") state.page += 1;
        if (action === "current") state.page = currentPageFor(state.ids, currentArtworkId);
        if (action === "scale-down" || action === "scale-up") {
          const direction = action === "scale-up" ? 1 : -1;
          uiState = {
            ...uiState,
            scaleIndex: Math.min(Math.max(uiState.scaleIndex + direction, 0), SCALE_STEPS.length - 1)
          };
          applyPanelUi(true);
          saveUiState();
          await renderPanel();
          return;
        }
        if (action === "toggle-page-mode") {
          uiState = {
            ...uiState,
            pageMode: uiState.pageMode === "wheel" ? "buttons" : "wheel"
          };
          saveUiState();
          await renderPanel();
          return;
        }
        if (action === "collapse") {
          setPanelCollapsed(!panel.classList.contains("is-collapsed"));
          return;
        }
        await renderPanel();
      });
    });
  }

  function startToolbarResize(event) {
    if (event.button !== 0 || !homeToolbar) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = homeToolbar.getBoundingClientRect();
    dragState = {
      target: homeToolbar,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startRight: rect.right,
      startTop: rect.top,
      startWidth: rect.width,
      moved: false,
      resizingToolbar: true,
      fromCollapsedButton: false
    };
    homeToolbar.classList.add("is-resizing");
    homeToolbar.setPointerCapture?.(event.pointerId);
  }

  function startPanelDrag(event) {
    if (event.button !== 0) return;
    const targetPanel = event.currentTarget;
    const isAuthorPanel = targetPanel === panel;
    const isHomePanel = targetPanel === homeToolbar;

    if (isAuthorPanel && !panel.classList.contains("is-collapsed") && event.target.closest(".pvm-ap-btn, .pvm-ap-card, a, input, select, textarea")) {
      return;
    }
    if (isHomePanel && event.target.closest("input, select, textarea, button")) return;

    const isCollapsedHandle = isAuthorPanel && panel.classList.contains("is-collapsed") && event.target.closest(".pvm-ap-collapse-btn");
    const isHeaderHandle = Boolean(event.target.closest("[data-drag-handle]"));
    if (!isCollapsedHandle && !isHeaderHandle) return;

    const rect = targetPanel.getBoundingClientRect();
    dragState = {
      target: targetPanel,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false,
      fromCollapsedButton: Boolean(isCollapsedHandle)
    };
    targetPanel.classList.add("is-dragging");
    targetPanel.setPointerCapture?.(event.pointerId);
  }

  function movePanelDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) dragState.moved = true;
    if (dragState.moved) event.preventDefault();

    if (dragState.resizingToolbar) {
      const nextWidth = clampNumber(dragState.startWidth - deltaX, HOME_TOOLBAR_MIN_WIDTH, HOME_TOOLBAR_MAX_WIDTH, 176);
      const nextLeft = dragState.startRight - nextWidth;
      uiState = { ...uiState, homeToolbarWidth: nextWidth, homeToolbarLeft: nextLeft, homeToolbarTop: dragState.startTop };
      homeToolbar.style.width = `${nextWidth}px`;
      homeToolbar.style.left = `${nextLeft}px`;
      homeToolbar.style.top = `${dragState.startTop}px`;
      homeToolbar.style.right = "auto";
      return;
    }

    const next = clampElementPosition(dragState.target, dragState.startLeft + deltaX, dragState.startTop + deltaY);
    if (dragState.target === homeToolbar) {
      uiState = { ...uiState, homeToolbarLeft: next.left, homeToolbarTop: next.top };
    } else {
      uiState = { ...uiState, left: next.left, top: next.top };
    }
    dragState.target.style.left = `${next.left}px`;
    dragState.target.style.top = `${next.top}px`;
    dragState.target.style.right = "auto";
  }

  function endPanelDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    const shouldExpandCollapsedClick = dragState.fromCollapsedButton && !dragState.moved;
    suppressNextClick = dragState.fromCollapsedButton && dragState.moved;
    const targetPanel = dragState.target;
    targetPanel.classList.remove("is-dragging", "is-resizing");
    targetPanel.releasePointerCapture?.(event.pointerId);
    if (dragState.moved) saveUiState();
    dragState = null;

    if (shouldExpandCollapsedClick) setPanelCollapsed(false);
  }

  function handlePanelWheel(event) {
    if (uiState.pageMode !== "wheel") return;
    if (panel.classList.contains("is-collapsed")) return;
    if (Math.abs(event.deltaY) < 20) return;

    const totalPages = getTotalPages();
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
        window.setTimeout(() => {
          wheelPagingLocked = false;
        }, 220);
      });
  }

  function clearUserArtworkPageEnhancements() {
    document.documentElement.style.removeProperty("--pvm-author-home-columns");
    document.documentElement.style.removeProperty("--pvm-author-home-scale");
    document.querySelectorAll(`.${HOME_GRID_CLASS}`).forEach((node) => {
      node.classList.remove(HOME_GRID_CLASS);
      if (node.dataset.pvmOriginalDisplay !== undefined) {
        if (node.dataset.pvmOriginalDisplay) {
          node.style.display = node.dataset.pvmOriginalDisplay;
        } else {
          node.style.removeProperty("display");
        }
        delete node.dataset.pvmOriginalDisplay;
      }
    });
    document.querySelectorAll(`.${HOME_HIDDEN_CLASS}`).forEach((node) => {
      node.classList.remove(HOME_HIDDEN_CLASS);
    });
  }

  function getArtworkListContainer() {
    const entries = [];
    document.querySelectorAll('a[href*="/artworks/"]').forEach((anchor) => {
      if (anchor.closest("#pvm-author-panel, #pvm-author-home-toolbar")) return;
      const parsed = PVM.parsePixivUrl(anchor.href);
      if (!parsed || parsed.type !== "artwork") return;

      let node = anchor;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        const parent = node.parentElement;
        if (!parent || parent.closest("#pvm-author-panel, #pvm-author-home-toolbar")) continue;
        const siblingCount = Array.from(parent.children).filter((child) => {
          if (child.matches?.('a[href*="/artworks/"]')) return true;
          return child.querySelector?.('a[href*="/artworks/"]');
        }).length;
        if (siblingCount >= 4) {
          entries.push({ id: parsed.id, anchor, card: node, parent });
          return;
        }
      }
    });

    const groups = new Map();
    entries.forEach((entry) => {
      const group = groups.get(entry.parent) || [];
      group.push(entry);
      groups.set(entry.parent, group);
    });

    let best = null;
    groups.forEach((group, parent) => {
      if (!best || group.length > best.entries.length) best = { parent, entries: group };
    });
    return best;
  }

  function getUserArtworkEntries() {
    const container = getArtworkListContainer();
    return container?.entries || [];
  }

  function applyUserArtworkGrid(container) {
    const scale = Math.max(1, HOME_GRID_MAX_COLUMNS / uiState.homeGridColumns);
    document.documentElement.style.setProperty("--pvm-author-home-columns", String(uiState.homeGridColumns));
    document.documentElement.style.setProperty("--pvm-author-home-scale", String(scale));
    document.querySelectorAll(`.${HOME_GRID_CLASS}`).forEach((node) => {
      if (node !== container?.parent) {
        node.classList.remove(HOME_GRID_CLASS);
        node.style.removeProperty("grid-template-columns");
        node.style.removeProperty("justify-content");
        node.style.removeProperty("align-items");
        if (node.dataset.pvmOriginalDisplay !== undefined) {
          if (node.dataset.pvmOriginalDisplay) {
            node.style.display = node.dataset.pvmOriginalDisplay;
          } else {
            node.style.removeProperty("display");
          }
          delete node.dataset.pvmOriginalDisplay;
        }
      }
    });

    if (!container?.parent || container.entries.length < 4) return;

    const parent = container.parent;
    parent.classList.add(HOME_GRID_CLASS);
    const display = getComputedStyle(parent).display;
    if (!display.includes("grid")) {
      if (parent.dataset.pvmOriginalDisplay === undefined) {
        parent.dataset.pvmOriginalDisplay = parent.style.display || "";
      }
      parent.style.display = "grid";
    }
  }

  async function ensureDetailsForIds(ids) {
    if (!state.userId || ids.length === 0) return;
    const missingIds = ids.filter((id) => !state.workMap[id]);
    if (missingIds.length === 0) return;

    const details = await fetchWorkDetails(state.userId, missingIds);
    state.workMap = { ...state.workMap, ...details };
    await setCache(state.userId, {
      userId: state.userId,
      userName: state.userName,
      ids: state.ids,
      workMap: state.workMap
    });
  }

  async function applyUserArtworkPageEnhancements() {
    if (applyingEnhancements) return;
    if (getRouteContext()?.type !== "userArtworks") {
      clearUserArtworkPageEnhancements();
      return;
    }

    applyingEnhancements = true;
    try {
      const container = getArtworkListContainer();
      const entries = container?.entries || [];
      applyUserArtworkGrid(container);
      renderHomeToolbar();

      const minPageCount = uiState.homeMinPageCount;
      if (minPageCount <= 1) {
        entries.forEach(({ card }) => card.classList.remove(HOME_HIDDEN_CLASS));
        document.querySelectorAll(`.${HOME_HIDDEN_CLASS}`).forEach((node) => node.classList.remove(HOME_HIDDEN_CLASS));
        return;
      }

      await ensureDetailsForIds(Array.from(new Set(entries.map(({ id }) => id))));
      entries.forEach(({ id, card }) => {
        const pageCount = state.workMap[id]?.pageCount;
        if (!Number.isFinite(Number(pageCount))) {
          card.classList.remove(HOME_HIDDEN_CLASS);
          return;
        }
        card.classList.toggle(HOME_HIDDEN_CLASS, Number(pageCount) < minPageCount);
      });
    } catch (error) {
      console.warn("[PVM] Failed to apply author homepage enhancements.", error);
    } finally {
      applyingEnhancements = false;
    }
  }

  function scheduleUserArtworkEnhancements(delay = 120) {
    window.clearTimeout(enhancementTimer);
    enhancementTimer = window.setTimeout(() => {
      applyUserArtworkPageEnhancements().catch(console.error);
    }, delay);
  }

  async function loadPanelForCurrentRoute() {
    const routeContext = getRouteContext();
    currentRouteContext = routeContext;
    if (!routeContext) {
      currentArtworkId = null;
      if (panel) panel.hidden = true;
      hideHomeToolbar();
      clearUserArtworkPageEnhancements();
      return;
    }

    const routeKey = routeContext.type === "artwork"
      ? `artwork:${routeContext.artworkId}`
      : `userArtworks:${routeContext.userId}`;
    const previousRouteKey = state.routeKey;
    if (routeKey === previousRouteKey && state.ids.length) {
      await renderPanel();
      scheduleUserArtworkEnhancements(0);
      return;
    }

    currentArtworkId = routeContext.type === "artwork" ? routeContext.artworkId : null;
    if (routeContext.type !== "userArtworks") {
      hideHomeToolbar();
      clearUserArtworkPageEnhancements();
    }
    state = {
      ids: [],
      workMap: {},
      userId: routeContext.type === "userArtworks" ? routeContext.userId : null,
      userName: "",
      page: 0,
      loading: true,
      error: "",
      routeKey
    };
    await renderPanel();

    try {
      const payload = routeContext.type === "artwork"
        ? await fetchAuthorWorksForArtwork(routeContext.artworkId)
        : await fetchAuthorWorksByUserId(routeContext.userId);
      state = {
        ids: payload.ids || [],
        workMap: payload.workMap || {},
        userId: payload.userId,
        userName: payload.userName || "",
        page: routeContext.type === "artwork" ? currentPageFor(payload.ids || [], routeContext.artworkId) : 0,
        loading: false,
        error: "",
        routeKey
      };
    } catch (error) {
      const fallback = fallbackWorksFromDom();
      state = {
        ids: fallback.ids,
        workMap: fallback.workMap,
        userId: routeContext.type === "userArtworks" ? routeContext.userId : null,
        userName: "",
        page: routeContext.type === "artwork" ? currentPageFor(fallback.ids, routeContext.artworkId) : 0,
        loading: false,
        error: fallback.ids.length ? "" : "作者作品加载失败",
        routeKey
      };
    }

    await renderPanel();
    scheduleUserArtworkEnhancements(0);
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
        if (mutation.addedNodes.length > 0 || mutation.type === "characterData") {
          scheduleUserArtworkEnhancements();
          return;
        }
      }
    });

    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  }

  function watchStorage() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (changes.viewedArtworks || changes.settings) {
        renderPanel().catch(console.error);
      }
    });
  }

  function watchWindow() {
    window.addEventListener("pointermove", movePanelDrag);
    window.addEventListener("pointerup", endPanelDrag);
    window.addEventListener("pointercancel", endPanelDrag);
    window.addEventListener("resize", () => {
      applyPanelUi(true);
      applyHomeToolbarUi(true);
      scheduleUserArtworkEnhancements(0);
    });
  }

  async function start() {
    await loadUiState();
    await loadPanelForCurrentRoute();
    watchRoute();
    watchDom();
    watchStorage();
    watchWindow();
  }

  start().catch(console.error);
})(globalThis);
