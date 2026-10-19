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

  function update() {
    const workspace = window.gZenWorkspaces?.getActiveWorkspaceFromCache?.();
    const containerId = Number(workspace?.containerTabId ?? 0);
    // No assigned container (or unavailable workspace API): keep all container dots.
    const css = Number.isSafeInteger(containerId) && containerId > 0
      ? `.tabbrowser-tab[usercontextid="${containerId}"] .tab-icon-stack::after { content: none !important; }`
      : "";
    if (style.textContent !== css) style.textContent = css;
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
  ];
  for (const event of events) window.addEventListener(event, scheduleUpdate);

  // Switching Spaces need not select another tab (e.g. shared Essentials).
  // Zen marks the viewed <zen-workspace> with the active attribute.
  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ["active"],
  });

  function cleanup() {
    window.clearTimeout(timer);
    observer.disconnect();
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
