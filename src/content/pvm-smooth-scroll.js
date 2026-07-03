// 平滑滚轮：一格滚轮固定翻动约 N 屏，只取滚轮方向、忽略 delta 大小，
// 用 rAF 缓动滚动，快速连滚时目标叠加（连翻好几格 = 翻很远），减轻长页面翻阅疲劳。
(function initSmoothScroll(global) {
  const PVM = global.PVM || {};

  let enabled = false;
  let screens = 1.0; // 一格滚轮翻动的视口高度倍数（“屏”）
  let listening = false;

  let targetY = null; // 当前缓动目标滚动位置；null 表示无进行中的动画
  let rafId = 0;

  function clampScreens(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 1.0;
    return Math.min(3.0, Math.max(0.3, num));
  }

  function getMaxScrollY() {
    const doc = document.scrollingElement || document.documentElement;
    return Math.max(0, doc.scrollHeight - window.innerHeight);
  }

  // 判断滚轮目标是否落在“自身可纵向滚动”的子容器内（评论区、作者作品速览面板等）。
  // 命中则交给原生滚动，不做整页翻动。
  function isInScrollableSubArea(target, direction) {
    let node = target instanceof Element ? target : target?.parentElement;
    const root = document.scrollingElement || document.documentElement;
    for (let depth = 0; node && node !== root && depth < 12; depth += 1, node = node.parentElement) {
      // 作者作品速览面板自带滚轮翻页逻辑，整块放行。
      if (node.id === "pvm-author-panel" || node.closest?.("#pvm-author-panel") === node) return true;

      const style = window.getComputedStyle(node);
      const overflowY = style.overflowY;
      const scrollable = overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
      if (!scrollable) continue;
      if (node.scrollHeight <= node.clientHeight + 1) continue;

      // 该容器在滚动方向上还有余量，说明用户是在滚它，放行。
      if (direction > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) return true;
      if (direction < 0 && node.scrollTop > 1) return true;
    }
    return false;
  }

  function step() {
    if (targetY === null) {
      rafId = 0;
      return;
    }
    const current = window.scrollY;
    const diff = targetY - current;
    if (Math.abs(diff) <= 1) {
      window.scrollTo(0, targetY);
      targetY = null;
      rafId = 0;
      return;
    }
    // ease-out：每帧靠近目标 22%，末端更顺滑。
    const next = current + diff * 0.22;
    window.scrollTo(0, next);
    rafId = window.requestAnimationFrame(step);
  }

  function handleWheel(event) {
    if (!enabled) return;
    // 缩放 / 其它手势：放行。
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // 横向滚动：不接管。
    if (event.deltaY === 0) return;

    const direction = event.deltaY > 0 ? 1 : -1;
    if (isInScrollableSubArea(event.target, direction)) return;

    event.preventDefault();

    const distance = window.innerHeight * clampScreens(screens) * direction;
    const base = targetY === null ? window.scrollY : targetY; // 连滚时叠加到已有目标上
    targetY = Math.min(getMaxScrollY(), Math.max(0, base + distance));

    if (!rafId) rafId = window.requestAnimationFrame(step);
  }

  function updateListener() {
    if (enabled && !listening) {
      window.addEventListener("wheel", handleWheel, { passive: false });
      listening = true;
    } else if (!enabled && listening) {
      window.removeEventListener("wheel", handleWheel, { passive: false });
      listening = false;
      targetY = null;
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    }
  }

  function applySettings(settings) {
    enabled = settings?.smoothScrollEnabled === true;
    screens = clampScreens(settings?.smoothScrollScreens);
    updateListener();
  }

  PVM.storage.getAllData()
    .then((data) => applySettings(data.settings))
    .catch(console.error);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.settings?.newValue) applySettings(changes.settings.newValue);
  });

  global.PVM = PVM;
})(globalThis);
