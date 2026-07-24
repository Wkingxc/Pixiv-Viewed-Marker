(function initAuthorCore(global) {
  const PVM = global.PVM = global.PVM || {};
  const author = PVM.author = PVM.author || {};

  // --- 常量 ---------------------------------------------------------------
  author.PAGE_SIZE = 6;
  author.CACHE_TTL = 30 * 60 * 1000;
  author.UI_STORAGE_KEY = "pvmAuthorPanelUi";
  author.HOME_GRID_MIN_COLUMNS = 2;
  author.HOME_GRID_MAX_COLUMNS = 6;
  author.HOME_MIN_PAGE_MAX = 999;
  author.HOME_GRID_CLASS = "pvm-author-home-grid";
  author.HOME_EXTRA_CLASS = "pvm-author-home-extra";
  author.HOME_HIDDEN_CLASS = "pvm-hidden-page-count-artwork";

  author.HOVER_PREVIEW_QUALITIES = ["off", "small", "medium", "original"];
  author.HIGH_RES_QUALITIES = ["small", "medium", "original"];
  // 简化档位名 -> Pixiv /ajax/illust urls 字段
  author.QUALITY_URL_KEY = {
    small: "small",
    medium: "regular",
    original: "original"
  };

  // --- 跨模块共享状态 -----------------------------------------------------
  // 这些状态由 core 持有，其它模块通过 getter/setter 修改，避免每个文件持有副本。
  let settings = { ...(PVM.DEFAULT_SETTINGS || {}) };
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
    pageMode: "scroll",
    minPageCount: 1,
    offsetX: 0
  };
  let currentArtworkId = null;
  let currentRouteContext = null;

  author.getSettings = () => settings;
  author.setSettings = (next) => { settings = next; };
  author.getState = () => state;
  author.setState = (next) => { state = next; };
  author.patchState = (patch) => { state = { ...state, ...patch }; };
  author.getUiState = () => uiState;
  author.setUiState = (next) => { uiState = next; };
  author.patchUiState = (patch) => { uiState = { ...uiState, ...patch }; };
  author.getCurrentArtworkId = () => currentArtworkId;
  author.setCurrentArtworkId = (id) => { currentArtworkId = id; };
  author.getCurrentRouteContext = () => currentRouteContext;
  author.setCurrentRouteContext = (ctx) => { currentRouteContext = ctx; };

  // --- URL / route --------------------------------------------------------
  function stripLocale(pathname) {
    return pathname.replace(/^\/(?:en|ja|zh|ko|zh-tw|zh-cn)(?=\/|$)/i, "") || "/";
  }

  function getRouteContext() {
    const parsed = PVM.parsePixivUrl(location.href);
    if (parsed?.type === "artwork") return { type: "artwork", artworkId: parsed.id };

    // 仅匹配 /users/{id} 和 /users/{id}/(artworks|illustrations|manga)[/...]，
    // 避免 /following /followers /bookmarks 等被误识别。
    const match = stripLocale(location.pathname).match(/^\/users\/(\d+)(?:\/(?:artworks|illustrations|manga)(?:\/[^/]*)?)?\/?$/);
    if (match) return { type: "userArtworks", userId: match[1] };
    return null;
  }

  author.stripLocale = stripLocale;
  author.getRouteContext = getRouteContext;

  // 把当前路由映射为统一的"页面显示设置"。
  // - userArtworks 路由读 authorPage*
  // - artwork 路由读 relatedWorks*
  // 其它情况返回 null（调用方应跳过相关增强）。
  function getDisplaySettingsForRoute(routeContext = currentRouteContext) {
    const s = author.getSettings();
    if (routeContext?.type === "userArtworks") {
      return {
        gridColumns: s.authorPageGridColumns,
        minPageCount: s.authorPageMinPageCount,
        useHighResThumbnails: s.authorPageUseHighResThumbnails,
        highResQuality: s.authorPageHighResThumbnailQuality,
        hoverEnabled: s.authorPageHoverPreviewEnabled,
        hoverQuality: s.authorPageHoverPreviewQuality
      };
    }
    if (routeContext?.type === "artwork") {
      if (s.relatedWorksEnabled === false) return null;
      return {
        gridColumns: s.relatedWorksGridColumns,
        minPageCount: s.relatedWorksMinPageCount,
        useHighResThumbnails: s.relatedWorksUseHighResThumbnails,
        highResQuality: s.relatedWorksHighResThumbnailQuality,
        hoverEnabled: s.relatedWorksHoverPreviewEnabled,
        hoverQuality: s.relatedWorksHoverPreviewQuality
      };
    }
    return null;
  }

  author.getDisplaySettingsForRoute = getDisplaySettingsForRoute;

  // --- 通用工具 -----------------------------------------------------------
  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(Math.max(Math.round(number), min), max);
  }

  function chunk(items, size) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  function sortIds(ids) {
    return ids.sort((a, b) => Number(b) - Number(a));
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

  author.clampNumber = clampNumber;
  author.chunk = chunk;
  author.sortIds = sortIds;
  author.escapeHtml = escapeHtml;
  author.escapeAttr = escapeAttr;

  // --- Quality 工具 -------------------------------------------------------
  function resolveQualityUrl(urls, quality) {
    if (!urls || !quality || quality === "off") return "";
    const key = author.QUALITY_URL_KEY[quality];
    if (key && typeof urls[key] === "string" && urls[key]) return urls[key];
    return "";
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

  author.resolveQualityUrl = resolveQualityUrl;
  author.pickImage = pickImage;
  author.pickPreviewImage = pickPreviewImage;
  author.pickHighResImage = pickHighResImage;
  author.pickHighResImageSet = pickHighResImageSet;
  author.normalizeWork = normalizeWork;

  // --- Pixiv API 客户端 ---------------------------------------------------
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

  // 缓存 /ajax/illust/{id} 返回的 urls，供高清缩略图按档位即时切换。
  const highResUrlsCache = new Map();
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

  author.fetchJson = fetchJson;
  author.fetchCurrentArtwork = fetchCurrentArtwork;
  author.fetchAuthorWorkIds = fetchAuthorWorkIds;
  author.fetchWorkDetails = fetchWorkDetails;
  author.fetchHighResUrls = fetchHighResUrls;

  // 跨作者按 id 拉单个作品详情（用于相关作品这种作者不一致的场景）。
  // 复用 fetchHighResUrls 的缓存以避免重复请求。
  const singleArtworkCache = new Map();
  async function fetchArtworkDetail(id) {
    const key = String(id);
    if (singleArtworkCache.has(key)) return singleArtworkCache.get(key);
    const promise = (async () => {
      try {
        const body = await fetchJson(`/ajax/illust/${key}`);
        if (!body || typeof body !== "object") return null;
        return normalizeWork(body, key);
      } catch (error) {
        console.warn("[PVM] Failed to fetch artwork detail for", key, error);
        return null;
      }
    })();
    singleArtworkCache.set(key, promise);
    return promise;
  }

  author.fetchArtworkDetail = fetchArtworkDetail;

  // --- 作者作品缓存（chrome.storage.local） ----------------------------
  async function getCache(userId) {
    const key = `pvmAuthorPanel:${userId}`;
    const data = await chrome.storage.local.get(key);
    const cached = data[key];
    if (!cached || Date.now() - cached.cachedAt > author.CACHE_TTL) return null;
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

  author.getCache = getCache;
  author.setCache = setCache;

  // --- settings / uiState 持久化 ----------------------------------------
  function normalizeUiState(raw) {
    // 历史值 "slider" / "buttons" 一律归一化为 "scroll"。
    const pageMode = raw?.pageMode === "wheel" ? "wheel" : "scroll";
    const minPageCount = clampNumber(raw?.minPageCount, 1, author.HOME_MIN_PAGE_MAX, 1);
    const offsetX = Number.isFinite(raw?.offsetX) ? raw.offsetX : 0;
    return {
      pageMode,
      minPageCount,
      offsetX
    };
  }

  async function loadUiState() {
    try {
      const data = await chrome.storage.local.get(author.UI_STORAGE_KEY);
      author.setUiState(normalizeUiState(data[author.UI_STORAGE_KEY]));
    } catch (error) {
      console.warn("[PVM] Failed to load author panel UI state.", error);
    }
  }

  function saveUiState() {
    chrome.storage.local.set({ [author.UI_STORAGE_KEY]: author.getUiState() }).catch((error) => {
      console.warn("[PVM] Failed to save author panel UI state.", error);
    });
  }

  function normalizeAuthorSettings(raw = {}) {
    const hoverEnabled = raw.authorPageHoverPreviewEnabled === true;
    const rawHoverQuality = typeof raw.authorPageHoverPreviewQuality === "string"
      ? raw.authorPageHoverPreviewQuality
      : (hoverEnabled ? "original" : "off");
    let hoverQuality = author.HOVER_PREVIEW_QUALITIES.includes(rawHoverQuality) ? rawHoverQuality : "off";
    if (hoverEnabled && hoverQuality === "off") hoverQuality = "original";
    if (!hoverEnabled) hoverQuality = "off";

    const rawHighResQuality = typeof raw.authorPageHighResThumbnailQuality === "string"
      ? raw.authorPageHighResThumbnailQuality
      : "original";
    const highResQuality = author.HIGH_RES_QUALITIES.includes(rawHighResQuality) ? rawHighResQuality : "original";

    const relatedHoverEnabled = raw.relatedWorksHoverPreviewEnabled === true;
    const rawRelatedHoverQuality = typeof raw.relatedWorksHoverPreviewQuality === "string"
      ? raw.relatedWorksHoverPreviewQuality
      : (relatedHoverEnabled ? "original" : "off");
    let relatedHoverQuality = author.HOVER_PREVIEW_QUALITIES.includes(rawRelatedHoverQuality) ? rawRelatedHoverQuality : "off";
    if (relatedHoverEnabled && relatedHoverQuality === "off") relatedHoverQuality = "original";
    if (!relatedHoverEnabled) relatedHoverQuality = "off";

    const rawRelatedHighResQuality = typeof raw.relatedWorksHighResThumbnailQuality === "string"
      ? raw.relatedWorksHighResThumbnailQuality
      : "original";
    const relatedHighResQuality = author.HIGH_RES_QUALITIES.includes(rawRelatedHighResQuality) ? rawRelatedHighResQuality : "original";

    return {
      ...(PVM.DEFAULT_SETTINGS || {}),
      ...(raw || {}),
      authorPageGridColumns: clampNumber(raw.authorPageGridColumns, author.HOME_GRID_MIN_COLUMNS, author.HOME_GRID_MAX_COLUMNS, 6),
      authorPageMinPageCount: clampNumber(raw.authorPageMinPageCount, 0, author.HOME_MIN_PAGE_MAX, 0),
      authorPageUseHighResThumbnails: raw.authorPageUseHighResThumbnails === true,
      authorPageHighResThumbnailQuality: highResQuality,
      authorPageHoverPreviewEnabled: hoverEnabled,
      authorPageHoverPreviewQuality: hoverQuality,
      relatedWorksGridColumns: clampNumber(raw.relatedWorksGridColumns, author.HOME_GRID_MIN_COLUMNS, author.HOME_GRID_MAX_COLUMNS, 6),
      relatedWorksMinPageCount: clampNumber(raw.relatedWorksMinPageCount, 0, author.HOME_MIN_PAGE_MAX, 0),
      relatedWorksEnabled: raw.relatedWorksEnabled !== false,
      relatedWorksUseHighResThumbnails: raw.relatedWorksUseHighResThumbnails === true,
      relatedWorksHighResThumbnailQuality: relatedHighResQuality,
      relatedWorksHoverPreviewEnabled: relatedHoverEnabled,
      relatedWorksHoverPreviewQuality: relatedHoverQuality,
      artworkPageHideAuthorWorks: raw.artworkPageHideAuthorWorks === true,
      artworkPageHideComments: raw.artworkPageHideComments === true
    };
  }

  async function loadSettings() {
    const data = await PVM.storage.getAllData();
    author.setSettings(normalizeAuthorSettings(data.settings));
  }

  author.normalizeUiState = normalizeUiState;
  author.loadUiState = loadUiState;
  author.saveUiState = saveUiState;
  author.normalizeAuthorSettings = normalizeAuthorSettings;
  author.loadSettings = loadSettings;

  // --- 作者作品索引获取 / 详情按页加载 ------------------------------
  async function fetchAuthorWorksByUserId(userId, userName = "") {
    const cached = await getCache(userId);
    if (cached?.ids?.length) {
      return { ...cached, userId, userName: userName || cached.userName || "" };
    }
    const ids = await fetchAuthorWorkIds(userId);
    const payload = { userId, userName, ids, workMap: {} };
    await setCache(userId, payload);
    return payload;
  }

  async function fetchAuthorWorksForArtwork(artworkId) {
    const current = await fetchCurrentArtwork(artworkId);
    if (!current.userId) throw new Error("Cannot detect author id.");
    return fetchAuthorWorksByUserId(current.userId, current.userName);
  }

  async function ensureDetailsForPage(page) {
    const s = author.getState();
    if (!s.userId || s.ids.length === 0) return;
    const ids = s.ids.slice(page * author.PAGE_SIZE, (page + 1) * author.PAGE_SIZE);
    const missingIds = ids.filter((id) => !s.workMap[id]);
    if (missingIds.length === 0) return;

    const details = await fetchWorkDetails(s.userId, missingIds);
    const next = author.getState();
    next.workMap = { ...next.workMap, ...details };
    await setCache(next.userId, {
      userId: next.userId,
      userName: next.userName,
      ids: next.ids,
      workMap: next.workMap
    });
  }

  async function preloadPageDetails(page) {
    const s = author.getState();
    if (!s.userId || s.ids.length === 0) return;
    const totalPages = Math.max(1, Math.ceil(s.ids.length / author.PAGE_SIZE));
    if (page < 0 || page >= totalPages) return;

    const ids = s.ids.slice(page * author.PAGE_SIZE, (page + 1) * author.PAGE_SIZE);
    const missingIds = ids.filter((id) => !s.workMap[id]);
    if (missingIds.length === 0) {
      preloadImagesForIds(ids);
      return;
    }

    try {
      const details = await fetchWorkDetails(s.userId, missingIds);
      const next = author.getState();
      next.workMap = { ...next.workMap, ...details };
      await setCache(next.userId, {
        userId: next.userId,
        userName: next.userName,
        ids: next.ids,
        workMap: next.workMap
      });
      preloadImagesForIds(ids);
    } catch (error) {
      console.warn("[PVM] Failed to preload author panel thumbnails.", error);
    }
  }

  // 把指定作品 ID 的缩略图丢给浏览器预解码，避免翻页时再发请求。
  const imagePreloadCache = new Set();
  function preloadImagesForIds(ids) {
    const s = author.getState();
    ids.forEach((id) => {
      if (imagePreloadCache.has(id)) return;
      const work = s.workMap[id];
      if (!work) return;
      const url = pickImage(work);
      if (!url) return;
      imagePreloadCache.add(id);
      const img = new Image();
      img.decoding = "async";
      img.loading = "eager";
      img.src = url;
    });
  }

  async function ensureDetailsForIds(ids, options = {}) {
    const requireHighRes = options.requireHighRes === true;
    const perId = options.perId === true;
    const s = author.getState();
    if (ids.length === 0) return;
    const missingIds = ids.filter((id) => {
      const work = s.workMap[id];
      if (!work) return true;
      return requireHighRes && work.highResImageChecked !== true;
    });
    if (missingIds.length === 0) return;

    // perId=true（如相关作品场景，作者各异）按 id 单拉；
    // 否则有 userId 时走作者批量接口，没有则按 id 单拉。
    let details = {};
    if (!perId && s.userId) {
      details = await fetchWorkDetails(s.userId, missingIds);
    } else {
      const fetched = await Promise.all(missingIds.map((id) => fetchArtworkDetail(id)));
      fetched.forEach((work) => {
        if (work && work.id) details[work.id] = work;
      });
    }

    const next = author.getState();
    next.workMap = { ...next.workMap, ...details };
    if (!perId && next.userId) {
      await setCache(next.userId, {
        userId: next.userId,
        userName: next.userName,
        ids: next.ids,
        workMap: next.workMap
      });
    }
  }

  function workForId(id) {
    const s = author.getState();
    return s.workMap[id] || {
      id,
      title: `Artwork ${id}`,
      image: "",
      pageCount: 1,
      createDate: "",
      xRestrict: 0
    };
  }

  function currentPageFor(ids, artworkId) {
    const index = ids.findIndex((id) => id === artworkId);
    if (index < 0) return 0;
    return Math.floor(index / author.PAGE_SIZE);
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

  async function getViewedSet() {
    const data = await PVM.storage.getAllData();
    return new Set(Object.keys(data.viewedArtworks || {}));
  }

  author.fetchAuthorWorksByUserId = fetchAuthorWorksByUserId;
  author.fetchAuthorWorksForArtwork = fetchAuthorWorksForArtwork;
  author.ensureDetailsForPage = ensureDetailsForPage;
  author.preloadPageDetails = preloadPageDetails;
  author.preloadImagesForIds = preloadImagesForIds;
  author.ensureDetailsForIds = ensureDetailsForIds;
  author.workForId = workForId;
  author.currentPageFor = currentPageFor;
  author.fallbackWorksFromDom = fallbackWorksFromDom;
  author.getViewedSet = getViewedSet;
})(globalThis);
