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
  const stackSelector = '.tabbrowser-tab[usercontextid]:not([usercontextid="0"]) .tab-icon-stack';
  const structureSelector = ".tabbrowser-tab, .tab-icon-stack, .tab-icon-image";
  const geometryProperties = ["x", "y", "width", "height", "content"];
  const stacks = new Map();
  const resizeTargets = new Map();
  const dirtyStacks = new Set();
  let timer;
  let syncNeeded = false;
  let allNeeded = false;
  let workspaceNeeded = false;

  const resizeObserver = new ResizeObserver(entries => {
    for (const { target } of entries) {
      const stack = resizeTargets.get(target);
      if (stack) dirtyStacks.add(stack);
    }
    if (dirtyStacks.size) schedule();
  });

  function removeStack(stack, icon) {
    resizeObserver.unobserve(stack);
    resizeObserver.unobserve(icon);
    resizeTargets.delete(stack);
    resizeTargets.delete(icon);
    dirtyStacks.delete(stack);
    for (const property of geometryProperties) {
      stack.style.removeProperty(`--zen-container-dot-${property}`);
    }
    stacks.delete(stack);
  }

  // Discover/remove icons only after relevant structural changes, not on resize.
  function syncStacks() {
    const current = new Set(document.querySelectorAll(stackSelector));
    for (const [stack, icon] of stacks) {
      if (!current.has(stack) || stack.querySelector(".tab-icon-image") !== icon) {
        removeStack(stack, icon);
      }
    }
    for (const stack of current) {
      if (stacks.has(stack)) continue;
      const icon = stack.querySelector(".tab-icon-image");
      if (!icon) continue;
      stacks.set(stack, icon);
      resizeTargets.set(stack, stack);
      resizeTargets.set(icon, stack);
      resizeObserver.observe(stack);
      resizeObserver.observe(icon);
      dirtyStacks.add(stack);
    }
  }

  function updateGeometry() {
    const measurements = [];
    for (const stack of dirtyStacks) {
      const icon = stacks.get(stack);
      if (!icon) continue;
      const outer = stack.getBoundingClientRect();
      const image = icon.getBoundingClientRect();
      if (!outer.width || !outer.height || !image.width || !image.height) continue;
      // Percentages cancel tab scale transforms and work in either text direction.
      measurements.push([stack, [
        `${100 * (image.left + image.width / 2 - outer.left) / outer.width}%`,
        `${100 * (image.top + image.height / 2 - outer.top) / outer.height}%`,
        `${100 * image.width / outer.width}%`,
        `${100 * image.height / outer.height}%`,
        '""',
      ]]);
    }
    dirtyStacks.clear();
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

  function updateWorkspace() {
    const workspace = window.gZenWorkspaces?.getActiveWorkspaceFromCache?.();
    const containerId = Number(workspace?.containerTabId ?? 0);
    // No assigned container (or unavailable workspace API): keep all container dots.
    const css = Number.isSafeInteger(containerId) && containerId > 0
      ? `.tabbrowser-tab[usercontextid="${containerId}"] .tab-icon-stack::after { content: none !important; }`
      : "";
    if (style.textContent !== css) style.textContent = css;
  }

  function flush() {
    timer = undefined;
    const sync = syncNeeded, all = allNeeded, workspace = workspaceNeeded;
    syncNeeded = allNeeded = workspaceNeeded = false;
    if (workspace) updateWorkspace();
    if (sync) syncStacks();
    if (all) for (const stack of stacks.keys()) dirtyStacks.add(stack);
    if (dirtyStacks.size) updateGeometry();
  }

  function schedule({ sync = false, all = false, workspace = false } = {}) {
    syncNeeded ||= sync;
    allNeeded ||= all;
    workspaceNeeded ||= workspace;
    // Coalesce notifications without repeatedly cancelling/restarting the timer.
    // Defer workspace reads because Zen may notify before updating its cache.
    if (timer === undefined) timer = window.setTimeout(flush, 0);
  }

  function markTab(tab) {
    for (const stack of tab.querySelectorAll(".tab-icon-stack")) {
      if (stacks.has(stack)) dirtyStacks.add(stack);
    }
  }

  function onEvent(event) {
    switch (event.type) {
      case "load":
      case "AfterWorkspacesSessionRestore":
        schedule({ sync: true, all: true, workspace: true });
        break;
      case "ZenWorkspacesUIUpdate":
        schedule({ all: true, workspace: true });
        break;
      case "ZenWorkspaceDataChanged":
      case "TabSelect":
        schedule({ workspace: true });
        break;
      case "resize":
        schedule({ all: true });
        break;
      default: {
        const tab = event.target?.closest?.(".tabbrowser-tab");
        if (tab) markTab(tab);
        schedule({ sync: event.type === "TabOpen" });
      }
    }
  }

  const events = [
    "load", "AfterWorkspacesSessionRestore", "ZenWorkspacesUIUpdate",
    "ZenWorkspaceDataChanged", "TabSelect", "TabOpen", "TabPinned", "TabUnpinned", "resize",
  ];
  for (const event of events) window.addEventListener(event, onEvent);

  const observer = new MutationObserver(records => {
    for (const record of records) {
      const target = record.target;
      // Ignore our stylesheet and unrelated chrome UI (menus, URL bar, tooltips).
      if (target === style) continue;
      if (record.type === "childList") {
        const nodes = [...record.addedNodes, ...record.removedNodes];
        const relevant = nodes.filter(node => node.nodeType === 1 &&
          (node.matches(structureSelector) || node.querySelector(structureSelector)));
        if (relevant.length) {
          // Moving an existing tab can change its local icon alignment without
          // changing the size observed by ResizeObserver.
          for (const node of relevant) {
            const stack = resizeTargets.get(node);
            if (stack) dirtyStacks.add(stack);
            for (const child of node.querySelectorAll(".tab-icon-stack")) {
              if (stacks.has(child)) dirtyStacks.add(child);
            }
          }
          const tab = target.closest?.(".tabbrowser-tab");
          if (tab) markTab(tab);
          schedule({ sync: true });
        }
      } else if (target.matches?.("zen-workspace") && record.attributeName === "active") {
        // A Space switch need not select a new tab (e.g. shared Essentials).
        schedule({ all: true, workspace: true });
      } else if (target === document.documentElement ||
                 target.id === "navigator-toolbox" || target.id === "tabbrowser-tabs") {
        schedule({ all: true });
      } else {
        const tab = target.closest?.(".tabbrowser-tab");
        if (!tab) continue;
        markTab(tab);
        schedule({ sync: record.attributeName === "usercontextid" || record.attributeName === "class" });
      }
    }
  });
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
    for (const [stack, icon] of stacks) removeStack(stack, icon);
    dirtyStacks.clear();
    for (const event of events) window.removeEventListener(event, onEvent);
    window.removeEventListener("unload", cleanup);
    style.remove();
    if (window.zenContainerDotCleanup === cleanup) delete window.zenContainerDotCleanup;
  }

  window.zenContainerDotCleanup = cleanup;
  window.addEventListener("unload", cleanup, { once: true });
  window.addUnloadListener?.(cleanup);
  syncNeeded = workspaceNeeded = true;
  flush();
})();
