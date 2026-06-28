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

    let result = null;
    let availableUrls = {};
    try {
      const body = await author.fetchJson(`/ajax/illust/${id}`);
      availableUrls = author.collectAvailableUrls(body);
      const direct = author.resolveQualityUrl(body.urls, quality);
      const image = direct || author.pickPreviewImage(body, quality);
      if (image) {
        let actualQuality = quality;
        if (!direct) {
          const matched = Object.keys(body.urls || {}).find((key) => body.urls[key] === image);
          actualQuality = matched || "fallback";
        }
        result = {
          id,
          title: body.title || author.getState().workMap[id]?.title || `Artwork ${id}`,
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
      const fallback = author.getState().workMap[id];
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
    const requested = author.HOVER_PREVIEW_QUALITY_LABELS[preview.quality] || preview.quality || "?";
    const actual = preview.actualQuality && preview.actualQuality !== preview.quality
      ? `（实际：${author.HOVER_PREVIEW_QUALITY_LABELS[preview.actualQuality] || preview.actualQuality}）`
      : "";
    const availableKeys = Object.keys(preview.availableUrls || {});
    const availableLine = availableKeys.length
      ? `<div class="pvm-ahp-meta">可用：${availableKeys.map((key) => author.escapeHtml(key)).join(" / ")}</div>`
      : "";
    target.innerHTML = `
      <img class="pvm-ahp-image" src="${author.escapeAttr(preview.image)}" alt="">
      <div class="pvm-ahp-caption">${author.escapeHtml(preview.title || "预览")}</div>
      <div class="pvm-ahp-meta">档位：${author.escapeHtml(requested)}${author.escapeHtml(actual)}</div>
      <div class="pvm-ahp-meta pvm-ahp-dimensions" data-pvm-dimensions>尺寸：加载中…</div>
      <div class="pvm-ahp-meta pvm-ahp-url" title="${author.escapeAttr(preview.image)}">URL：${author.escapeHtml(author.shortenUrl(preview.image))}</div>
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
    const quality = author.getSettings().authorPageHoverPreviewQuality;
    if (!quality || quality === "off") return;
    window.clearTimeout(hoverPreviewTimer);
    const token = hoverPreviewToken + 1;
    hoverPreviewToken = token;
    hoverPreviewTimer = window.setTimeout(async () => {
      renderHoverPreview(`加载预览中… (${author.HOVER_PREVIEW_QUALITY_LABELS[quality] || quality})`, event);
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
    const quality = author.getSettings().authorPageHoverPreviewQuality;
    if (!quality || quality === "off") return;
    if (!entry?.card || entry.card.dataset.pvmHoverPreviewBound === "true") return;
    entry.card.dataset.pvmHoverPreviewBound = "true";
    entry.card.addEventListener("pointerenter", (event) => startHoverPreview(entry, event));
    entry.card.addEventListener("pointermove", positionHoverPreview);
    entry.card.addEventListener("pointerleave", hideHoverPreview);
  }

  function applyHoverPreviewBindings(entries) {
    const quality = author.getSettings().authorPageHoverPreviewQuality;
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
