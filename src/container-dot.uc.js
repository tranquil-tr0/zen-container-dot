// ==UserScript==
// @name           Zen Container Dot
// @description    Hide the dot for the viewed Space's assigned container.
// @include        chrome://browser/content/browser.xhtml
// ==/UserScript==

(() => {
  if (window.location.href !== "chrome://browser/content/browser.xhtml") return;

  // Sine can reload scripts without opening a new browser window.
  window.zenContainerDotCleanup?.();

  const style = document.createElementNS("http://www.w3.org/1999/xhtml", "style");
  style.id = "zen-container-dot-workspace-style";
  document.documentElement.appendChild(style);
  let timer;
  const stacks = new Map();
  const geometryProperties = ["x", "y", "width", "height", "visibility"];
  const resizeObserver = new ResizeObserver(scheduleUpdate);

  function updateGeometry() {
    const current = new Set(document.querySelectorAll(
      '.tabbrowser-tab[usercontextid]:not([usercontextid="0"]) .tab-icon-stack'
    ));
    for (const [stack, icon] of stacks) {
      if (!current.has(stack) || stack.querySelector(".tab-icon-image") !== icon) {
        resizeObserver.unobserve(stack);
        resizeObserver.unobserve(icon);
        for (const property of geometryProperties) {
          stack.style.removeProperty(`--zen-container-dot-${property}`);
        }
        stacks.delete(stack);
      }
    }
    const measurements = [];
    for (const stack of current) {
      const icon = stack.querySelector(".tab-icon-image");
      if (!icon) continue;
      if (!stacks.has(stack)) {
        stacks.set(stack, icon);
        resizeObserver.observe(stack);
        resizeObserver.observe(icon);
      }
      const outer = stack.getBoundingClientRect();
      const image = icon.getBoundingClientRect();
      if (!outer.width || !outer.height || !image.width || !image.height) continue;
      // Percentages cancel tab scale transforms and work in either text direction.
      measurements.push([stack, [
        `${100 * (image.left + image.width / 2 - outer.left) / outer.width}%`,
        `${100 * (image.top + image.height / 2 - outer.top) / outer.height}%`,
        `${100 * image.width / outer.width}%`,
        `${100 * image.height / outer.height}%`,
        "visible",
      ]]);
    }
    // Read all bounds before writing styles to avoid repeated layout work.
    for (const [stack, values] of measurements) {
      geometryProperties.forEach((property, index) => {
        const name = `--zen-container-dot-${property}`;
        if (stack.style.getPropertyValue(name) !== values[index]) {
          stack.style.setProperty(name, values[index]);
        }
      });
    }
  }

  function update() {
    const workspace = window.gZenWorkspaces?.getActiveWorkspaceFromCache?.();
    const containerId = Number(workspace?.containerTabId ?? 0);
    // No assigned container (or unavailable workspace API): keep all container dots.
    const css = Number.isSafeInteger(containerId) && containerId > 0
      ? `.tabbrowser-tab[usercontextid="${containerId}"] .tab-icon-stack::after { content: none !important; }`
      : "";
    if (style.textContent !== css) style.textContent = css;
    updateGeometry();
  }

  function scheduleUpdate() {
    window.clearTimeout(timer);
    // Workspace data notifications may precede the cache/UI update.
    timer = window.setTimeout(update, 0);
  }

  const events = [
    "load",
    "AfterWorkspacesSessionRestore",
    "ZenWorkspacesUIUpdate",
    "ZenWorkspaceDataChanged",
    "TabSelect",
    "TabOpen",
    "TabPinned",
    "TabUnpinned",
    "resize",
  ];
  for (const event of events) window.addEventListener(event, scheduleUpdate);

  // Switching Spaces need not select another tab (e.g. shared Essentials).
  // Zen marks the viewed <zen-workspace> with the active attribute.
  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    childList: true,
    attributeFilter: ["active", "hidden", "class", "usercontextid", "zen-sidebar-expanded", "zen-pinned-changed"],
  });

  function cleanup() {
    window.clearTimeout(timer);
    observer.disconnect();
    resizeObserver.disconnect();
    for (const stack of stacks.keys()) {
      for (const property of geometryProperties) {
        stack.style.removeProperty(`--zen-container-dot-${property}`);
      }
    }
    stacks.clear();
    for (const event of events) window.removeEventListener(event, scheduleUpdate);
    window.removeEventListener("unload", cleanup);
    style.remove();
    if (window.zenContainerDotCleanup === cleanup) delete window.zenContainerDotCleanup;
  }

  window.zenContainerDotCleanup = cleanup;
  window.addEventListener("unload", cleanup, { once: true });
  window.addUnloadListener?.(cleanup);
  update();
})();
