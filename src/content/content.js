(async function initContentScript() {
  const processedAnchors = new WeakMap();
  const recentIntentMap = new Map();
  const viewedArtworkSet = new Set();
  const viewedUserSet = new Set();
  const excludedPageSet = new Set();
  let settings = PVM.DEFAULT_SETTINGS;
  let currentHref = location.href;
  let scanTimer = null;
  let syncTimer = null;
  let renderVersion = 0;

  function colorToCss(color) {
    const fallback = PVM.DEFAULT_COLOR;
    const value = { ...fallback, ...(color || {}) };
    return `rgba(${value.r}, ${value.g}, ${value.b}, ${value.a})`;
  }

  function applySettings(nextSettings) {
    settings = { ...PVM.DEFAULT_SETTINGS, ...(nextSettings || {}) };
    renderVersion += 1;
    document.documentElement.style.setProperty(
      "--pvm-viewed-color",
      colorToCss(settings.artworkVisitedColor)
    );
    document.documentElement.style.setProperty(
      "--pvm-overlay-opacity",
      String(settings.artworkImageOverlayOpacity ?? 0.28)
    );
  }

  function hasVisibleText(anchor) {
    return Boolean(anchor.textContent && anchor.textContent.trim().length > 0);
  }

  function findArtworkCard(anchor) {
    let node = anchor.parentElement;
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      if (node.querySelectorAll?.('a[href*="/artworks/"]').length >= 1) {
        const text = node.textContent?.trim() || "";
        if (text.length > 0 && text.length < 500) return node;
      }
    }
    return null;
  }

  function normalizeCurrentPage() {
    return PVM.normalizePixivPagePattern(location.href)?.pattern || "";
  }

  function isRenderExcludedPage() {
    const currentPattern = normalizeCurrentPage();
    return Array.from(excludedPageSet).some((pattern) => {
      return currentPattern === pattern || currentPattern.startsWith(`${pattern}/`);
    });
  }

  function markCardTitle(anchor) {
    const card = findArtworkCard(anchor);
    if (!card) return;

    card.dataset.pvmViewedCard = "true";

    const textLinks = Array.from(card.querySelectorAll('a[href*="/artworks/"]'))
      .filter((candidate) => hasVisibleText(candidate));
    textLinks.forEach((candidate) => {
      candidate.classList.add(PVM.VIEWED_CLASS);
      candidate.dataset.pvmTitleCandidate = "true";
    });

    if (textLinks.length > 0) return;

    const textNodes = Array.from(card.querySelectorAll("figcaption, h2, h3, p, span, div"))
      .filter((candidate) => {
        const text = candidate.textContent?.trim() || "";
        if (!text || text.length > 80) return false;
        if (candidate.querySelector("img, svg, button")) return false;
        if (candidate.closest('a[href*="/users/"]')) return false;
        if (candidate.querySelector('a[href*="/users/"]')) return false;
        return candidate.children.length <= 2;
      });

    textNodes.slice(0, 3).forEach((candidate) => {
      candidate.dataset.pvmTitleCandidate = "true";
    });
  }

  function clearCardMarks(card) {
    if (!card) return;
    delete card.dataset.pvmViewedCard;
    card.classList.remove("pvm-hidden-viewed-artwork");
    card.querySelectorAll("[data-pvm-title-candidate]").forEach((candidate) => {
      delete candidate.dataset.pvmTitleCandidate;
      candidate.classList.remove(PVM.VIEWED_CLASS);
    });
    card.querySelectorAll(".pvm-viewed-artwork").forEach((candidate) => {
      candidate.classList.remove(PVM.VIEWED_CLASS);
    });
    card.querySelectorAll(".pvm-viewed-image-wrap").forEach((candidate) => {
      candidate.classList.remove("pvm-viewed-image-wrap");
    });
  }

  function markImage(anchor) {
    if (!settings.markArtworkImage) return;
    if (!anchor.querySelector("img, picture")) return;
    anchor.classList.add("pvm-viewed-image-wrap");
  }

  function clearCardTitleMarks(anchor) {
    const card = findArtworkCard(anchor);
    clearCardMarks(card);
  }

  function hideCard(anchor) {
    if (!settings.hideViewedArtwork) return;
    const card = findArtworkCard(anchor);
    if (!card) return;
    card.classList.add("pvm-hidden-viewed-artwork");
  }

  function markAnchor(anchor, parsed) {
    anchor.classList.remove(PVM.VIEWED_CLASS, "pvm-viewed-image-wrap");
    delete anchor.dataset.pvmViewed;
    clearCardTitleMarks(anchor);

    if (!parsed || parsed.type !== "artwork") return;
    if (isRenderExcludedPage()) return;
    if (!viewedArtworkSet.has(parsed.id)) return;

    hideCard(anchor);
    if (settings.hideViewedArtwork) return;

    markImage(anchor);

    if (settings.markArtworkTitle && hasVisibleText(anchor)) {
      anchor.classList.add(PVM.VIEWED_CLASS);
      anchor.dataset.pvmViewed = "true";
      return;
    }

    if (settings.markArtworkTitle) markCardTitle(anchor);
  }

  function scanNode(root = document, force = false) {
    const anchors = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches?.('a[href*="/artworks/"]')) {
      anchors.push(root);
    }
    root.querySelectorAll?.('a[href*="/artworks/"]').forEach((anchor) => anchors.push(anchor));

    anchors.forEach((anchor) => {
      if (anchor.closest("#pvm-author-panel")) return;
      const parsed = PVM.parsePixivUrl(anchor.href);
      const renderExcluded = isRenderExcludedPage();
      const visitState = parsed && viewedArtworkSet.has(parsed.id) && !renderExcluded
        ? "viewed"
        : "unviewed";
      const renderState = `${visitState}:${renderVersion}`;
      if (!force && processedAnchors.get(anchor) === renderState) return;
      processedAnchors.set(anchor, renderState);
      if (renderExcluded) {
        anchor.classList.remove(PVM.VIEWED_CLASS, "pvm-viewed-image-wrap");
        delete anchor.dataset.pvmViewed;
        clearCardTitleMarks(anchor);
        return;
      }
      markAnchor(anchor, parsed);
    });
  }

  function scheduleScan(root = document, force = false) {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => scanNode(root, force), 150);
  }

  function scanSoon(root = document, force = false) {
    window.requestAnimationFrame(() => scanNode(root, force));
  }

  async function syncStorageAndScan(root = document) {
    const data = await PVM.storage.getAllData();
    viewedArtworkSet.clear();
    viewedUserSet.clear();
    excludedPageSet.clear();
    Object.keys(data.viewedArtworks).forEach((id) => viewedArtworkSet.add(id));
    Object.keys(data.viewedUsers).forEach((id) => viewedUserSet.add(id));
    Object.keys(data.exclusions.pages || {}).forEach((pattern) => excludedPageSet.add(pattern));
    applySettings(data.settings);
    scanNode(root, true);
  }

  function scheduleStorageSync(root = document, delay = 80) {
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      syncStorageAndScan(root).catch(console.error);
    }, delay);
  }

  async function recordCurrentPage() {
    const parsed = PVM.parsePixivUrl(location.href);
    if (!parsed) {
      scheduleStorageSync(document, 50);
      return;
    }

    if (parsed.type === "artwork") viewedArtworkSet.add(parsed.id);
    if (parsed.type === "user") viewedUserSet.add(parsed.id);

    const intentKey = `${parsed.type}:${parsed.id}`;
    if (Date.now() - (recentIntentMap.get(intentKey) || 0) < 2000) {
      scheduleStorageSync(document, 50);
      return;
    }

    await PVM.storage.recordParsedVisit(parsed);
    scheduleStorageSync(document, 50);
  }

  function recordVisitSafely(parsed, timestamp) {
    const fallback = () => {
      PVM.storage.recordParsedVisit(parsed, timestamp).catch(console.error);
    };

    try {
      if (!chrome.runtime?.sendMessage) {
        fallback();
        return;
      }

      chrome.runtime
        .sendMessage({
          type: "PVM_RECORD_VISIT",
          parsed,
          timestamp
        })
        .catch(fallback);
    } catch (_error) {
      fallback();
    }
  }

  function recordIntentFromEvent(event) {
    const anchor = event.target.closest?.("a[href]");
    if (!anchor) return;

    const parsed = PVM.parsePixivUrl(anchor.href);
    if (!parsed) return;

    const intentKey = `${parsed.type}:${parsed.id}`;
    const now = Date.now();
    if (now - (recentIntentMap.get(intentKey) || 0) < 1200) {
      if (parsed.type === "artwork") {
        viewedArtworkSet.add(parsed.id);
        markAnchor(anchor, parsed);
        scanSoon(document, true);
      }
      return;
    }
    recentIntentMap.set(intentKey, now);

    if (parsed.type === "artwork") viewedArtworkSet.add(parsed.id);
    if (parsed.type === "user") viewedUserSet.add(parsed.id);

    recordVisitSafely(parsed, now);

    if (parsed.type === "artwork") {
      markAnchor(anchor, parsed);
      scanSoon(document, true);
      scheduleScan(document, true);
    }
  }

  function watchDom() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0 || mutation.type === "characterData") {
          scheduleScan(document, true);
          return;
        }
      }
    });

    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  }

  function watchUrlChanges() {
    const notifyUrlChanged = () => {
      window.setTimeout(() => {
        if (location.href !== currentHref) currentHref = location.href;
        recordCurrentPage().catch(console.error);
      }, 0);
    };

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function patchedPushState(...args) {
      const result = originalPushState.apply(this, args);
      notifyUrlChanged();
      return result;
    };
    history.replaceState = function patchedReplaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      notifyUrlChanged();
      return result;
    };

    window.addEventListener("popstate", notifyUrlChanged);
    window.addEventListener("hashchange", notifyUrlChanged);

    window.setInterval(() => {
      if (location.href === currentHref) return;
      currentHref = location.href;
      recordCurrentPage().catch(console.error);
    }, 300);
  }

  function watchPageResume() {
    const refresh = () => scheduleStorageSync(document, 20);

    window.addEventListener("pageshow", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refresh();
    });

    let burstCount = 0;
    const burst = window.setInterval(() => {
      burstCount += 1;
      scheduleStorageSync(document, 0);
      if (burstCount >= 10) window.clearInterval(burst);
    }, 500);
  }

  function watchDynamicContent() {
    let lastY = window.scrollY;
    let stableTicks = 0;

    window.addEventListener(
      "scroll",
      () => {
        scanSoon(document, true);
      },
      { passive: true }
    );

    window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (window.scrollY === lastY) {
        stableTicks += 1;
      } else {
        stableTicks = 0;
        lastY = window.scrollY;
      }

      if (stableTicks < 8) {
        scanNode(document, true);
      }
    }, 900);
  }

  function watchStorageChanges() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;

      if (changes.viewedArtworks?.newValue) {
        viewedArtworkSet.clear();
        Object.keys(changes.viewedArtworks.newValue).forEach((id) => viewedArtworkSet.add(id));
      }

      if (changes.viewedUsers?.newValue) {
        viewedUserSet.clear();
        Object.keys(changes.viewedUsers.newValue).forEach((id) => viewedUserSet.add(id));
      }

      if (changes.exclusions?.newValue) {
        excludedPageSet.clear();
        Object.keys(changes.exclusions.newValue.pages || {}).forEach((pattern) => excludedPageSet.add(pattern));
      }

      if (changes.viewedArtworks || changes.viewedUsers || changes.exclusions) {
        scheduleScan(document, true);
      }

      if (changes.settings?.newValue) {
        applySettings(changes.settings.newValue);
        scheduleScan(document, true);
      }
    });
  }

  const data = await PVM.storage.getAllData();
  applySettings(data.settings);
  Object.keys(data.viewedArtworks).forEach((id) => viewedArtworkSet.add(id));
  Object.keys(data.viewedUsers).forEach((id) => viewedUserSet.add(id));
  Object.keys(data.exclusions.pages || {}).forEach((pattern) => excludedPageSet.add(pattern));

  document.addEventListener("pointerdown", recordIntentFromEvent, true);
  document.addEventListener("mousedown", recordIntentFromEvent, true);
  document.addEventListener("click", recordIntentFromEvent, true);
  document.addEventListener("auxclick", recordIntentFromEvent, true);
  await recordCurrentPage();
  scanNode(document, true);
  watchDom();
  watchUrlChanges();
  watchPageResume();
  watchDynamicContent();
  watchStorageChanges();
})();
