const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const panelJs = fs.readFileSync(path.join(root, "src/content/author-panel.js"), "utf8");
const panelCss = fs.readFileSync(path.join(root, "src/content/author-panel.css"), "utf8");

test("author panel header puts position text and actions on one row", () => {
  assert.match(panelJs, /<div class="pvm-ap-head" data-drag-handle="true">[\s\S]*<span class="pvm-ap-current">\$\{currentText\}<\/span>/);
  assert.doesNotMatch(panelJs, /class="pvm-ap-title"/);
  assert.doesNotMatch(panelJs, /<strong>作者作品速览<\/strong>/);
  assert.doesNotMatch(panelJs, /<strong>\$\{state\.userName \|\| "作者作品速览"\}<\/strong>/);
  assert.match(panelCss, /\.pvm-ap-current\s*\{/);
  assert.doesNotMatch(panelCss, /\.pvm-ap-title/);
});

test("collapsed author panel uses an icon-only floating affordance", () => {
  assert.match(panelJs, /class="pvm-ap-collapse-icon"/);
  assert.match(panelJs, /aria-label="\$\{isCollapsed \? "展开作者作品速览" : "收起作者作品速览"\}"/);
  assert.match(panelJs, /function setPanelCollapsed\(isCollapsed\)/);
  assert.match(panelCss, /#pvm-author-panel\.is-collapsed\s*\{/);
  assert.match(panelCss, /border-radius:\s*999px;/);
  assert.match(panelCss, /\.pvm-ap-collapse-label\s*\{/);
  assert.match(panelJs, /if \(dragState\.moved\) event\.preventDefault\(\)/);
  assert.match(panelJs, /fromCollapsedButton/);
  assert.match(panelJs, /setPanelCollapsed\(false\)/);
});

test("author panel keeps draggable position and scale in local ui state", () => {
  assert.match(panelJs, /UI_STORAGE_KEY = "pvmAuthorPanelUi"/);
  assert.match(panelJs, /SCALE_STEPS = \[1, 1\.2, 1\.4\]/);
  assert.match(panelJs, /data-action="scale-down"/);
  assert.match(panelJs, /data-action="scale-up"/);
  assert.match(panelCss, /--pvm-ap-scale/);
  assert.match(panelCss, /width: calc\(392px \* var\(--pvm-ap-scale\)\)/);
});

test("author panel supports button paging and wheel paging modes", () => {
  assert.match(panelJs, /pageMode: "buttons"/);
  assert.match(panelJs, /data-action="toggle-page-mode"/);
  assert.match(panelJs, /handlePanelWheel/);
  assert.match(panelJs, /event\.deltaY/);
  assert.match(panelCss, /\.pvm-ap-wheel-hint/);
});

test("author panel supports user artworks route and homepage controls", () => {
  assert.match(panelJs, /userArtworks/);
  assert.match(panelJs, /\/users\\\/\(\\d\+\)\(\?:\\\/\(\?:artworks\|illustrations\|manga\)\)\?/);
  assert.match(panelJs, /illustrations\|manga/);
  assert.match(panelJs, /homeGridColumns: 6/);
  assert.match(panelJs, /homeMinPageCount: 0/);
  assert.match(panelJs, /function renderHomeControls\(\)/);
  assert.match(panelJs, /data-action="\$\{action\}-down"/);
  assert.match(panelJs, /data-action="\$\{action\}-up"/);
  assert.match(panelJs, /home-columns-down/);
  assert.match(panelJs, /data-action="home-min-page-count-change"/);
  assert.match(panelCss, /\.pvm-ap-step-btn/);
  assert.match(panelJs, /homeToolbarWidth: 176/);
  assert.match(panelJs, /function startToolbarResize\(event\)/);
  assert.match(panelCss, /\.pvm-ap-resize-handle/);
  assert.match(panelCss, /cursor:\s*ew-resize/);
  assert.match(panelJs, /每行/);
  assert.match(panelJs, /最低页数/);
});

test("author homepage grid and page-count filtering have static hooks", () => {
  assert.match(panelJs, /pvm-author-home-grid/);
  assert.match(panelJs, /pvm-hidden-page-count-artwork/);
  assert.match(panelJs, /function applyUserArtworkPageEnhancements\(\)/);
  assert.match(panelJs, /--pvm-author-home-columns/);
  assert.match(panelJs, /fetchWorkDetails\(state\.userId, missingIds\)/);
  assert.match(panelCss, /\.pvm-author-home-grid\s*\{/);
  assert.match(panelCss, /grid-template-columns:\s*repeat\(var\(--pvm-author-home-columns, 6\), minmax\(0, 1fr\)\) !important;/);
  assert.match(panelCss, /\.pvm-author-home-grid > \*/);
  assert.match(panelCss, /transform:\s*scale\(var\(--pvm-author-home-scale, 1\)\)/);
  assert.match(panelCss, /row-gap:\s*calc\(140px \* \(var\(--pvm-author-home-scale, 1\) - 1\) \+ 32px\) !important;/);
  assert.match(panelCss, /\.pvm-hidden-page-count-artwork\s*\{[\s\S]*display:\s*none !important;/);
});

test("author panel stays available on normal desktop widths", () => {
  assert.doesNotMatch(panelCss, /max-width:\s*1500px/);
  assert.match(panelCss, /max-width:\s*900px/);
});

test("current button is placed in the footer after previous button", () => {
  assert.match(panelJs, /data-action="prev"[\s\S]*data-action="current"[\s\S]*pvm-ap-page[\s\S]*data-action="next"/);
  assert.doesNotMatch(panelJs, /pvm-ap-actions">\s*<button class="pvm-ap-btn" data-action="current"/);
});

test("author panel preloads the next page after rendering current page", () => {
  assert.match(panelJs, /function preloadPageDetails\(page\)/);
  assert.match(panelJs, /void preloadPageDetails\(state\.page \+ 1\)/);
  assert.match(panelJs, /const missingIds = ids\.filter\(\(id\) => !state\.workMap\[id\]\)/);
});

test("the whole header row is draggable except interactive controls", () => {
  assert.match(panelJs, /<div class="pvm-ap-head" data-drag-handle="true">/);
  assert.match(panelJs, /event\.target\.closest\("\.pvm-ap-btn, \.pvm-ap-card, a, input, select, textarea"\)/);
  assert.match(panelJs, /targetPanel === homeToolbar/);
  assert.match(panelCss, /\.pvm-ap-head\s*\{[\s\S]*cursor: grab;/);
});
