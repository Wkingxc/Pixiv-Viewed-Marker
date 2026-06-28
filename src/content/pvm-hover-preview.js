(function initHoverPreview(global) {
  const PVM = global.PVM = global.PVM || {};
  const author = PVM.author = PVM.author || {};
  const hover = author.hover = author.hover || {};

  let hoverPreview = null;
  let hoverPreviewTimer = null;
  let hoverPreviewToken = 0;
  const hoverPreviewCache = new Map();

  async function fetchArtworkPreview(artworkId, quality) {
    const id = String(artworkId);
    const cacheKey = `${id}:${quality}`;
    if (hoverPreviewCache.has(cacheKey)) return hoverPreviewCache.get(cacheKey);

    let image = "";
    try {
      const body = await author.fetchJson(`/ajax/illust/${id}`);
      image = author.resolveQualityUrl(body.urls, quality) || author.pickPreviewImage(body, quality);
    } catch (error) {
      console.warn("[PVM] Failed to fetch hover preview image.", error);
    }

    if (!image) {
      const fallback = author.getState().workMap[id];
      image = fallback?.highResImage || fallback?.image || "";
    }

    const result = image ? { id, image } : null;
    hoverPreviewCache.set(cacheKey, result);
    return result;
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
    target.innerHTML = `<div class="pvm-ahp-message">${author.escapeHtml(message)}</div>`;
    target.hidden = false;
    positionHoverPreview(event);
  }

  function renderHoverPreviewImage(preview, event) {
    const target = ensureHoverPreview();
    target.classList.add("has-image");
    target.classList.remove("is-error");
    target.innerHTML = `<img class="pvm-ahp-image" src="${author.escapeAttr(preview.image)}" alt="">`;
    target.hidden = false;
    positionHoverPreview(event);
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
    const quality = author.getDisplaySettingsForRoute()?.hoverQuality;
    if (!quality || quality === "off") return;
    window.clearTimeout(hoverPreviewTimer);
    const token = hoverPreviewToken + 1;
    hoverPreviewToken = token;
    hoverPreviewTimer = window.setTimeout(async () => {
      renderHoverPreview("加载中…", event);
      const preview = await fetchArtworkPreview(entry.id, quality);
      if (token !== hoverPreviewToken) return;
      if (!preview?.image) {
        const target = ensureHoverPreview();
        target.classList.add("is-error");
        target.innerHTML = '<div class="pvm-ahp-message">没有可预览图片</div>';
        target.hidden = false;
        positionHoverPreview(event);
        return;
      }
      renderHoverPreviewImage(preview, event);
    }, 140);
  }

  // 只把绑定挂在卡片里的缩略图节点上（<img>，或者占位 <figure> / <canvas>），
  // 避免悬停在作品标题、作者名、关注按钮等区域时也弹出预览。
  function pickThumbnailTarget(entry) {
    if (!entry?.card) return null;
    return (
      entry.card.querySelector("img") ||
      entry.card.querySelector("figure") ||
      entry.card.querySelector("canvas") ||
      null
    );
  }

  function bindHoverPreviewEntry(entry) {
    const quality = author.getDisplaySettingsForRoute()?.hoverQuality;
    if (!quality || quality === "off") return;
    if (!entry?.card) return;
    const target = pickThumbnailTarget(entry);
    if (!target || target.dataset.pvmHoverPreviewBound === "true") return;
    // 在 card 上留个标记，防止重复扫描；事件只绑在 thumbnail target 上
    entry.card.dataset.pvmHoverPreviewBound = "true";
    target.dataset.pvmHoverPreviewBound = "true";
    target.addEventListener("pointerenter", (event) => startHoverPreview(entry, event));
    target.addEventListener("pointermove", positionHoverPreview);
    target.addEventListener("pointerleave", hideHoverPreview);
  }

  function applyHoverPreviewBindings(entries) {
    const quality = author.getDisplaySettingsForRoute()?.hoverQuality;
    if (!quality || quality === "off") {
      hideHoverPreview();
      return;
    }
    entries.forEach(bindHoverPreviewEntry);
  }

  hover.fetchArtworkPreview = fetchArtworkPreview;
  hover.hideHoverPreview = hideHoverPreview;
  hover.clearHoverPreview = clearHoverPreview;
  hover.applyHoverPreviewBindings = applyHoverPreviewBindings;
  hover.bindHoverPreviewEntry = bindHoverPreviewEntry;
})(globalThis);
