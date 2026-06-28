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

  const HOVER_PREVIEW_QUALITIES = ["off", "small", "medium", "original"];
  const HOVER_PREVIEW_QUALITY_LABELS = {
    off: "关闭",
    small: "small（540 长边）",
    medium: "medium（1200 长边）",
    original: "original（原图）"
  };
  const HIGH_RES_QUALITIES = ["small", "medium", "original"];
  const HIGH_RES_QUALITY_LABELS = {
    small: "small（540 长边）",
    medium: "medium（1200 长边）",
    original: "original（原图）"
  };
  // 把简化档位名映射到 Pixiv /ajax/illust 返回的 urls 字段。
  const QUALITY_URL_KEY = {
    small: "small",
    medium: "regular",
    original: "original"
  };

  let panel = null;
  let currentArtworkId = null;
  let currentRouteContext = null;
  let dragState = null;
  let suppressNextClick = false;
  let wheelPagingLocked = false;
  let enhancementTimer = null;
  let applyingEnhancements = false;
  let hoverPreview = null;
  let hoverPreviewTimer = null;
  let hoverPreviewToken = 0;
  const hoverPreviewCache = new Map();
  // 缓存 /ajax/illust/{id} 返回的 urls 字段，供高清缩略图按档位即时切换。
  const highResUrlsCache = new Map();
  let settings = { ...PVM.DEFAULT_SETTINGS };
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
    collapsedLeft: null,
    collapsedTop: null,
    scaleIndex: 0,
    pageMode: "buttons",
    authorPanelExpanded: false
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

  function resolveQualityUrl(urls, quality) {
    if (!urls || !quality || quality === "off") return "";
    const key = QUALITY_URL_KEY[quality];
    if (key && typeof urls[key] === "string" && urls[key]) return urls[key];
    return "";
  }

  function pickPreviewImage(work, quality) {
    const urls = work?.urls || {};
    const direct = resolveQualityUrl(urls, quality);
    if (direct) return direct;
    return (
      urls.original ||
      urls.regular ||
      urls.small ||
      work.url ||
      urls.thumb ||
      urls.thumb_mini ||
      urls.mini ||
      work.thumbnail ||
      work.thumbnailUrl ||
      ""
    );
  }

  function collectAvailableUrls(work) {
    const urls = work?.urls || {};
    const available = {};
    Object.keys(urls).forEach((key) => {
      if (typeof urls[key] === "string" && urls[key]) available[key] = urls[key];
    });
    if (work?.url && !available.regular) available.url = work.url;
    return available;
  }

  function pickHighResImage(work, quality) {
    const urls = work?.urls || {};
    const direct = resolveQualityUrl(urls, quality);
    if (direct) return direct;
    return (
      urls.regular ||
      urls.small ||
      work.url ||
      urls.thumb ||
      urls.thumb_mini ||
      urls.mini ||
      work.thumbnail ||
      work.thumbnailUrl ||
      ""
    );
  }

  function pickHighResImageSet(work, quality) {
    const image = pickHighResImage(work, quality);
    if (!image) return "";
    return `${image} 1x, ${image} 2x`;
  }

  function normalizeWork(work, id) {
    return {
      id: String(work.id || id),
      title: work.title || "Untitled",
      image: pickImage(work),
      urls: work.urls && typeof work.urls === "object" ? { ...work.urls } : {},
      url: work.url || "",
      highResImage: pickHighResImage(work, "small"),
      highResImageSet: pickHighResImageSet(work, "small"),
      highResImageChecked: true,
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
      collapsedLeft: Number.isFinite(raw?.collapsedLeft) ? raw.collapsedLeft : null,
      collapsedTop: Number.isFinite(raw?.collapsedTop) ? raw.collapsedTop : null,
      scaleIndex,
      pageMode,
      authorPanelExpanded: raw?.authorPanelExpanded === true
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

  function normalizeAuthorSettings(raw = {}) {
    const hoverEnabled = raw.authorPageHoverPreviewEnabled === true;
    const rawHoverQuality = typeof raw.authorPageHoverPreviewQuality === "string"
      ? raw.authorPageHoverPreviewQuality
      : (hoverEnabled ? "original" : "off");
    let hoverQuality = HOVER_PREVIEW_QUALITIES.includes(rawHoverQuality) ? rawHoverQuality : "off";
    if (hoverEnabled && hoverQuality === "off") hoverQuality = "original";
    if (!hoverEnabled) hoverQuality = "off";

    const rawHighResQuality = typeof raw.authorPageHighResThumbnailQuality === "string"
      ? raw.authorPageHighResThumbnailQuality
      : "original";
    const highResQuality = HIGH_RES_QUALITIES.includes(rawHighResQuality) ? rawHighResQuality : "original";

    return {
      ...PVM.DEFAULT_SETTINGS,
      ...(raw || {}),
      authorPageGridColumns: clampNumber(raw.authorPageGridColumns, HOME_GRID_MIN_COLUMNS, HOME_GRID_MAX_COLUMNS, 6),
      authorPageMinPageCount: clampNumber(raw.authorPageMinPageCount, 0, HOME_MIN_PAGE_MAX, 0),
      authorPageUseHighResThumbnails: raw.authorPageUseHighResThumbnails === true,
      authorPageHighResThumbnailQuality: highResQuality,
      authorPageHoverPreviewEnabled: hoverEnabled,
      authorPageHoverPreviewQuality: hoverQuality
    };
  }

  async function loadSettings() {
    const data = await PVM.storage.getAllData();
    settings = normalizeAuthorSettings(data.settings);
  }

  async function migrateLegacyHomeSettings() {
    try {
      const data = await chrome.storage.local.get([UI_STORAGE_KEY, "settings"]);
      const legacy = data[UI_STORAGE_KEY];
      const storedSettings = data.settings || {};
      const patch = {};
      if (storedSettings.authorPageGridColumns === undefined && Number.isFinite(legacy?.homeGridColumns)) {
        patch.authorPageGridColumns = clampNumber(legacy.homeGridColumns, HOME_GRID_MIN_COLUMNS, HOME_GRID_MAX_COLUMNS, 6);
      }
      if (storedSettings.authorPageMinPageCount === undefined && Number.isFinite(legacy?.homeMinPageCount)) {
        patch.authorPageMinPageCount = clampNumber(legacy.homeMinPageCount, 0, HOME_MIN_PAGE_MAX, 0);
      }
      if (storedSettings.authorPageUseHighResThumbnails === undefined && legacy?.homeUseHighResThumbnails === true) {
        patch.authorPageUseHighResThumbnails = true;
      }
      if (Object.keys(patch).length === 0) return;
      settings = normalizeAuthorSettings(await PVM.storage.saveSettings(patch));
    } catch (error) {
      console.warn("[PVM] Failed to migrate author homepage settings.", error);
    }
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

    const isCollapsed = panel.classList.contains("is-collapsed");
    const left = isCollapsed ? uiState.collapsedLeft : uiState.left;
    const top = isCollapsed ? uiState.collapsedTop : uiState.top;
    const leftKey = isCollapsed ? "collapsedLeft" : "left";
    const topKey = isCollapsed ? "collapsedTop" : "top";

    if (Number.isFinite(left) && Number.isFinite(top)) {
      const next = clampPanelPosition(left, top);
      panel.style.left = `${next.left}px`;
      panel.style.top = `${next.top}px`;
      panel.style.right = "auto";
      if (next.left !== left || next.top !== top) {
        uiState = { ...uiState, [leftKey]: next.left, [topKey]: next.top };
        if (persistClamp) saveUiState();
      }
      return;
    }

    panel.style.left = "auto";
    panel.style.top = "84px";
    panel.style.right = "24px";
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

  async function fetchArtworkPreview(artworkId, quality) {
    const id = String(artworkId);
    const cacheKey = `${id}:${quality}`;
    if (hoverPreviewCache.has(cacheKey)) return hoverPreviewCache.get(cacheKey);

    let result = null;
    let availableUrls = {};
    try {
      const body = await fetchJson(`/ajax/illust/${id}`);
      availableUrls = collectAvailableUrls(body);
      const direct = resolveQualityUrl(body.urls, quality);
      const image = direct || pickPreviewImage(body, quality);
      if (image) {
        let actualQuality = quality;
        if (!direct) {
          const matched = Object.keys(body.urls || {}).find((key) => body.urls[key] === image);
          actualQuality = matched || "fallback";
        }
        result = {
          id,
          title: body.title || state.workMap[id]?.title || `Artwork ${id}`,
          image,
          quality,
          actualQuality,
          availableUrls
        };
      }
    } catch (error) {
      console.warn("[PVM] Failed to fetch hover preview image.", error);
    }

    if (!result) {
      const fallback = state.workMap[id];
      const image = fallback?.highResImage || fallback?.image || "";
      result = image ? {
        id,
        title: fallback?.title || `Artwork ${id}`,
        image,
        quality,
        actualQuality: "fallback",
        availableUrls
      } : null;
    }

    hoverPreviewCache.set(cacheKey, result);
    return result;
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

  const COLLAPSE_ICON_EXPANDED = `<svg class="pvm-ap-collapse-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  const COLLAPSE_ICON_COLLAPSED = `<svg class="pvm-ap-collapse-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4.5" y="4.5" width="6" height="6" rx="1.4" fill="currentColor"/><rect x="13.5" y="4.5" width="6" height="6" rx="1.4" fill="currentColor"/><rect x="4.5" y="13.5" width="6" height="6" rx="1.4" fill="currentColor"/><rect x="13.5" y="13.5" width="6" height="6" rx="1.4" fill="currentColor"/></svg>`;

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
    if (icon) icon.innerHTML = nextCollapsed ? COLLAPSE_ICON_COLLAPSED : COLLAPSE_ICON_EXPANDED;
    if (label) label.textContent = nextCollapsed ? "展开" : "收起";
  }

  function renderCollapseButton() {
    const isCollapsed = panel?.classList.contains("is-collapsed");
    const iconSvg = isCollapsed ? COLLAPSE_ICON_COLLAPSED : COLLAPSE_ICON_EXPANDED;
    return `
      <button
        class="pvm-ap-btn pvm-ap-collapse-btn"
        data-action="collapse"
        type="button"
        aria-label="${isCollapsed ? "展开作者作品速览" : "收起作者作品速览"}"
        title="${isCollapsed ? "展开作者作品速览" : "收起作者作品速览"}"
      >
        <span class="pvm-ap-collapse-icon" aria-hidden="true">${iconSvg}</span>
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

  function startPanelDrag(event) {
    if (event.button !== 0) return;
    const targetPanel = event.currentTarget;
    const isAuthorPanel = targetPanel === panel;

    if (isAuthorPanel && !panel.classList.contains("is-collapsed") && event.target.closest(".pvm-ap-btn, .pvm-ap-card, a, input, select, textarea")) {
      return;
    }

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

    const next = clampElementPosition(dragState.target, dragState.startLeft + deltaX, dragState.startTop + deltaY);
    const isCollapsed = dragState.target === panel && panel.classList.contains("is-collapsed");
    const leftKey = isCollapsed ? "collapsedLeft" : "left";
    const topKey = isCollapsed ? "collapsedTop" : "top";
    uiState = { ...uiState, [leftKey]: next.left, [topKey]: next.top };
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
    clearHoverPreview();
    restoreUserArtworkCardImages();
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
      if (anchor.closest("#pvm-author-panel")) return;
      const parsed = PVM.parsePixivUrl(anchor.href);
      if (!parsed || parsed.type !== "artwork") return;

      let node = anchor;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        const parent = node.parentElement;
        if (!parent || parent.closest("#pvm-author-panel")) continue;
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

  function getEntryImage(entry) {
    return entry?.card?.querySelector?.("img") || entry?.anchor?.querySelector?.("img") || null;
  }

  function ensureHoverPreview() {
    if (hoverPreview) return hoverPreview;
    hoverPreview = document.createElement("aside");
    hoverPreview.id = "pvm-author-hover-preview";
    hoverPreview.hidden = true;
    document.documentElement.append(hoverPreview);
    return hoverPreview;
  }

  function positionHoverPreview(event) {
    if (!hoverPreview || hoverPreview.hidden) return;
    const margin = 12;
    const gap = 18;
    const width = hoverPreview.offsetWidth || 320;
    const height = hoverPreview.offsetHeight || 240;
    let left = event.clientX + gap;
    let top = event.clientY + gap;
    if (left + width + margin > window.innerWidth) left = event.clientX - width - gap;
    if (top + height + margin > window.innerHeight) top = event.clientY - height - gap;
    hoverPreview.style.left = `${Math.max(margin, left)}px`;
    hoverPreview.style.top = `${Math.max(margin, top)}px`;
  }

  function renderHoverPreview(message, event) {
    const target = ensureHoverPreview();
    target.classList.remove("has-image", "is-error");
    target.innerHTML = `<div class="pvm-ahp-message">${escapeHtml(message)}</div>`;
    target.hidden = false;
    positionHoverPreview(event);
  }

  function renderHoverPreviewImage(preview, event) {
    const target = ensureHoverPreview();
    target.classList.add("has-image");
    target.classList.remove("is-error");
    const requested = HOVER_PREVIEW_QUALITY_LABELS[preview.quality] || preview.quality || "?";
    const actual = preview.actualQuality && preview.actualQuality !== preview.quality
      ? `（实际：${HOVER_PREVIEW_QUALITY_LABELS[preview.actualQuality] || preview.actualQuality}）`
      : "";
    const availableKeys = Object.keys(preview.availableUrls || {});
    const availableLine = availableKeys.length
      ? `<div class="pvm-ahp-meta">可用：${availableKeys.map((key) => escapeHtml(key)).join(" / ")}</div>`
      : "";
    target.innerHTML = `
      <img class="pvm-ahp-image" src="${escapeAttr(preview.image)}" alt="">
      <div class="pvm-ahp-caption">${escapeHtml(preview.title || "预览")}</div>
      <div class="pvm-ahp-meta">档位：${escapeHtml(requested)}${escapeHtml(actual)}</div>
      <div class="pvm-ahp-meta pvm-ahp-dimensions" data-pvm-dimensions>尺寸：加载中…</div>
      <div class="pvm-ahp-meta pvm-ahp-url" title="${escapeAttr(preview.image)}">URL：${escapeHtml(shortenUrl(preview.image))}</div>
      ${availableLine}
    `;
    target.hidden = false;
    positionHoverPreview(event);

    const img = target.querySelector(".pvm-ahp-image");
    const dimsEl = target.querySelector("[data-pvm-dimensions]");
    if (img && dimsEl) {
      const updateDims = () => {
        if (img.naturalWidth && img.naturalHeight) {
          dimsEl.textContent = `尺寸：${img.naturalWidth} × ${img.naturalHeight}`;
        } else {
          dimsEl.textContent = "尺寸：未知";
        }
      };
      if (img.complete) updateDims();
      else {
        img.addEventListener("load", updateDims, { once: true });
        img.addEventListener("error", () => { dimsEl.textContent = "尺寸：加载失败"; }, { once: true });
      }
    }
  }

  function shortenUrl(url) {
    if (typeof url !== "string" || url.length <= 72) return url || "";
    return `${url.slice(0, 40)}…${url.slice(-28)}`;
  }

  function hideHoverPreview() {
    window.clearTimeout(hoverPreviewTimer);
    hoverPreviewTimer = null;
    hoverPreviewToken += 1;
    if (hoverPreview) hoverPreview.hidden = true;
  }

  function clearHoverPreview() {
    hideHoverPreview();
  }

  function startHoverPreview(entry, event) {
    const quality = settings.authorPageHoverPreviewQuality;
    if (!quality || quality === "off") return;
    window.clearTimeout(hoverPreviewTimer);
    const token = hoverPreviewToken + 1;
    hoverPreviewToken = token;
    hoverPreviewTimer = window.setTimeout(async () => {
      renderHoverPreview(`加载预览中… (${HOVER_PREVIEW_QUALITY_LABELS[quality] || quality})`, event);
      const preview = await fetchArtworkPreview(entry.id, quality);
      if (token !== hoverPreviewToken) return;
      if (!preview?.image) {
        const target = ensureHoverPreview();
        target.classList.add("is-error");
        target.innerHTML = '<div class="pvm-ahp-message">没有拿到可预览图片</div>';
        target.hidden = false;
        positionHoverPreview(event);
        return;
      }
      renderHoverPreviewImage(preview, event);
    }, 140);
  }

  function bindHoverPreviewEntry(entry) {
    if (!settings.authorPageHoverPreviewQuality || settings.authorPageHoverPreviewQuality === "off") return;
    if (!entry?.card || entry.card.dataset.pvmHoverPreviewBound === "true") return;
    entry.card.dataset.pvmHoverPreviewBound = "true";
    entry.card.addEventListener("pointerenter", (event) => startHoverPreview(entry, event));
    entry.card.addEventListener("pointermove", positionHoverPreview);
    entry.card.addEventListener("pointerleave", hideHoverPreview);
  }

  function applyHoverPreviewBindings(entries) {
    if (!settings.authorPageHoverPreviewQuality || settings.authorPageHoverPreviewQuality === "off") {
      hideHoverPreview();
      return;
    }
    entries.forEach(bindHoverPreviewEntry);
  }

  function rememberOriginalAttribute(node, attribute) {
    const property = attribute.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const valueKey = `pvmOriginal${property[0].toUpperCase()}${property.slice(1)}`;
    const hadKey = `pvmOriginalHad${property[0].toUpperCase()}${property.slice(1)}`;
    if (node.dataset[hadKey] !== undefined) return;
    node.dataset[valueKey] = node.getAttribute(attribute) || "";
    node.dataset[hadKey] = node.hasAttribute(attribute) ? "true" : "false";
  }

  function restoreOriginalAttribute(node, attribute) {
    const property = attribute.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const valueKey = `pvmOriginal${property[0].toUpperCase()}${property.slice(1)}`;
    const hadKey = `pvmOriginalHad${property[0].toUpperCase()}${property.slice(1)}`;
    if (node.dataset[hadKey] === "true") {
      node.setAttribute(attribute, node.dataset[valueKey] || "");
    } else {
      node.removeAttribute(attribute);
    }
    delete node.dataset[valueKey];
    delete node.dataset[hadKey];
  }

  function getResponsiveSources(img) {
    const picture = img.closest("picture");
    return picture ? Array.from(picture.querySelectorAll("source")) : [];
  }

  function rememberOriginalImage(img) {
    if (!img || img.dataset.pvmOriginalImageStored === "true") return;
    img.dataset.pvmOriginalImageStored = "true";
    ["src", "srcset", "sizes", "data-src", "data-srcset"].forEach((attribute) => {
      rememberOriginalAttribute(img, attribute);
    });
    getResponsiveSources(img).forEach((source) => {
      source.dataset.pvmHighResSourceTouched = "true";
      ["srcset", "sizes", "data-srcset"].forEach((attribute) => {
        rememberOriginalAttribute(source, attribute);
      });
    });
  }

  function restoreHighResSource(source) {
    if (!source || source.dataset.pvmHighResSourceTouched !== "true") return;
    ["srcset", "sizes", "data-srcset"].forEach((attribute) => {
      restoreOriginalAttribute(source, attribute);
    });
    delete source.dataset.pvmHighResSourceTouched;
  }

  function restoreHighResImage(img) {
    if (!img || img.dataset.pvmHighResImageApplied !== "true") return;
    getResponsiveSources(img).forEach(restoreHighResSource);
    ["src", "srcset", "sizes", "data-src", "data-srcset"].forEach((attribute) => {
      restoreOriginalAttribute(img, attribute);
    });
    delete img.dataset.pvmHighResImageApplied;
    delete img.dataset.pvmHighResImageUrl;
    delete img.dataset.pvmOriginalImageStored;
  }

  function restoreUserArtworkCardImages(root = document) {
    root.querySelectorAll?.('img[data-pvm-high-res-image-applied="true"]').forEach(restoreHighResImage);
    root.querySelectorAll?.('source[data-pvm-high-res-source-touched="true"]').forEach(restoreHighResSource);
  }

  async function fetchHighResUrls(id) {
    const key = String(id);
    if (highResUrlsCache.has(key)) return highResUrlsCache.get(key);
    const promise = (async () => {
      try {
        const body = await fetchJson(`/ajax/illust/${key}`);
        return body?.urls && typeof body.urls === "object" ? body.urls : {};
      } catch (error) {
        console.warn("[PVM] Failed to fetch high-res urls for", key, error);
        return {};
      }
    })();
    highResUrlsCache.set(key, promise);
    return promise;
  }

  async function ensureHighResUrlsForEntry(entry, quality) {
    const work = state.workMap[entry.id];
    if (!work) return null;
    if (resolveQualityUrl(work.urls, quality)) return work.urls;

    const urls = await fetchHighResUrls(entry.id);
    if (!urls || Object.keys(urls).length === 0) return work.urls || null;
    state.workMap[entry.id] = {
      ...work,
      urls: { ...(work.urls || {}), ...urls }
    };
    return state.workMap[entry.id].urls;
  }

  function applyHighResImageToEntry(entry) {
    const quality = settings.authorPageHighResThumbnailQuality;
    const work = state.workMap[entry.id];
    if (!work) return;
    const highResImage = pickHighResImage(work, quality);
    if (!highResImage) return;

    const img = getEntryImage(entry);
    if (!img || img.closest("#pvm-author-panel")) return;

    const highResImageSet = pickHighResImageSet(work, quality) || `${highResImage} 1x, ${highResImage} 2x`;
    const alreadyApplied = img.dataset.pvmHighResImageUrl === highResImage
      && img.getAttribute("src") === highResImage
      && img.getAttribute("srcset") === highResImageSet;
    if (alreadyApplied) return;

    rememberOriginalImage(img);
    img.dataset.pvmHighResImageApplied = "true";
    img.dataset.pvmHighResImageUrl = highResImage;
    img.setAttribute("src", highResImage);
    img.setAttribute("srcset", highResImageSet);
    img.setAttribute("data-src", highResImage);
    img.setAttribute("data-srcset", highResImageSet);
    img.removeAttribute("sizes");
    getResponsiveSources(img).forEach((source) => {
      source.dataset.pvmHighResSourceTouched = "true";
      ["srcset", "sizes", "data-srcset"].forEach((attribute) => {
        rememberOriginalAttribute(source, attribute);
      });
      source.setAttribute("srcset", highResImageSet);
      source.setAttribute("data-srcset", highResImageSet);
      source.removeAttribute("sizes");
    });
  }

  function getIdsMissingDetails(ids, options = {}) {
    const requireHighRes = options.requireHighRes === true;
    return ids.filter((id) => {
      const work = state.workMap[id];
      if (!work) return true;
      return requireHighRes && work.highResImageChecked !== true;
    });
  }

  function applyUserArtworkGrid(container) {
    const scale = Math.max(1, HOME_GRID_MAX_COLUMNS / settings.authorPageGridColumns);
    document.documentElement.style.setProperty("--pvm-author-home-columns", String(settings.authorPageGridColumns));
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

  async function ensureDetailsForIds(ids, options = {}) {
    if (!state.userId || ids.length === 0) return;
    const missingIds = getIdsMissingDetails(ids, options);
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
      const entryIds = Array.from(new Set(entries.map(({ id }) => id)));
      applyUserArtworkGrid(container);
      applyHoverPreviewBindings(entries);

      const minPageCount = settings.authorPageMinPageCount;
      const useHighResThumbnails = settings.authorPageUseHighResThumbnails;
      if (minPageCount > 1 || useHighResThumbnails) {
        await ensureDetailsForIds(entryIds, { requireHighRes: useHighResThumbnails });
      }

      if (useHighResThumbnails) {
        const highResQuality = settings.authorPageHighResThumbnailQuality;
        if (highResQuality === "medium" || highResQuality === "original") {
          await Promise.all(entries.map((entry) => ensureHighResUrlsForEntry(entry, highResQuality)));
        }
        entries.forEach(applyHighResImageToEntry);
      } else {
        restoreUserArtworkCardImages();
      }

      if (minPageCount <= 1) {
        entries.forEach(({ card }) => card.classList.remove(HOME_HIDDEN_CLASS));
        document.querySelectorAll(`.${HOME_HIDDEN_CLASS}`).forEach((node) => node.classList.remove(HOME_HIDDEN_CLASS));
        return;
      }

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
        if (mutation.target?.parentElement?.closest?.("#pvm-author-hover-preview")) continue;
        if (Array.from(mutation.addedNodes).some((node) => node.id === "pvm-author-hover-preview" || node.closest?.("#pvm-author-hover-preview"))) continue;
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
      if (changes.settings) {
        settings = normalizeAuthorSettings(changes.settings.newValue);
        scheduleUserArtworkEnhancements(0);
      }
      if (changes.viewedArtworks || changes.settings) {
        renderPanel().catch(console.error);
      }
    });
  }

  function watchWindow() {
    window.addEventListener("pointermove", movePanelDrag);
    window.addEventListener("pointerup", endPanelDrag);
    window.addEventListener("pointercancel", endPanelDrag);
    window.addEventListener("scroll", hideHoverPreview, true);
    window.addEventListener("resize", () => {
      hideHoverPreview();
      applyPanelUi(true);
      scheduleUserArtworkEnhancements(0);
    });
  }

  async function start() {
    await loadUiState();
    await loadSettings();
    await migrateLegacyHomeSettings();
    await loadPanelForCurrentRoute();
    watchRoute();
    watchDom();
    watchStorage();
    watchWindow();
  }

  start().catch(console.error);
})(globalThis);
