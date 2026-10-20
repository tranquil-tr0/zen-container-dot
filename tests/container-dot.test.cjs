const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const vm = require("node:vm");

const script = readFileSync(`${__dirname}/../src/container-dot.uc.js`, "utf8");

function browser(containerTabId, iconStacks = []) {
  const listeners = new Map();
  const styles = [];
  let workspace = { containerTabId };
  let mutationCallback;
  let pending;
  let disconnected = false;
  let resizeCallback;
  const stats = { scans: 0, workspaceReads: 0, timers: 0 };
  const observed = new Set();
  const workspaceElement = { matches: selector => selector === "zen-workspace" };
  const window = {
    location: { href: "chrome://browser/content/browser.xhtml" },
    gZenWorkspaces: { getActiveWorkspaceFromCache: () => { stats.workspaceReads++; return workspace; } },
    setTimeout: fn => { stats.timers++; pending = fn; return 1; },
    clearTimeout: () => { pending = undefined; },
    addEventListener: (name, fn) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
    addUnloadListener: fn => { window.sineCleanup = fn; },
  };
  const document = {
    documentElement: { appendChild: style => styles.push(style) },
    createElementNS: () => ({ textContent: "", remove() { this.removed = true; } }),
    querySelectorAll: () => { stats.scans++; return iconStacks; },
  };
  const context = vm.createContext({
    window, document,
    MutationObserver: class {
      constructor(fn) { mutationCallback = fn; }
      observe() {}
      disconnect() { disconnected = true; }
    },
    ResizeObserver: class {
      constructor(fn) { resizeCallback = fn; }
      observe(node) { observed.add(node); }
      unobserve(node) { observed.delete(node); }
      disconnect() { observed.clear(); }
    },
  });
  const run = () => vm.runInContext(script, context);
  run();
  return {
    window, styles, run, stats, observed,
    css: () => styles.at(-1).textContent,
    workspace: value => { workspace = value; },
    event: (name, target) => { for (const fn of listeners.get(name) ?? []) fn({ type: name, target }); },
    mutate: (records = [{ type: "attributes", attributeName: "active", target: workspaceElement }]) => mutationCallback(records),
    resize: (targets = iconStacks) => resizeCallback(targets.map(target => ({ target }))),
    flush: () => { const fn = pending; pending = undefined; fn?.(); },
    disconnected: () => disconnected,
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

test("suppression follows the viewed Space, even without a tab selection", () => {
  const app = browser(1);
  assert.match(app.css(), /usercontextid="1"/);
  assert.match(app.css(), /content: none !important/);
  app.workspace({ containerTabId: 12 });
  app.mutate();
  app.flush();
  assert.match(app.css(), /usercontextid="12"/);
  assert.doesNotMatch(app.css(), /usercontextid="1"/);
});

test("circle tracks image bounds with asymmetric margins, scaling, and layout changes", () => {
  const properties = new Map();
  let outer = { left: 100, top: 50, width: 26, height: 20 };
  let image = { left: 104, top: 52, width: 16, height: 16 };
  const icon = { getBoundingClientRect: () => image };
  const stack = {
    querySelector: () => icon,
    getBoundingClientRect: () => outer,
    style: {
      getPropertyValue: name => properties.get(name),
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: name => properties.delete(name),
    },
  };
  const app = browser(1, [stack]);
  function checkCenter() {
    const x = parseFloat(properties.get("--zen-container-dot-x")) / 100 * outer.width + outer.left;
    const y = parseFloat(properties.get("--zen-container-dot-y")) / 100 * outer.height + outer.top;
    assert.ok(Math.abs(x - (image.left + image.width / 2)) < 0.001);
    assert.ok(Math.abs(y - (image.top + image.height / 2)) < 0.001);
    assert.equal(properties.get("--zen-container-dot-content"), '""');
    assert.equal(properties.has("--zen-container-dot-visibility"), false);
  }
  checkCenter();
  // A scaled wrapper with the image shifted toward its right edge (RTL/sidebar).
  outer = { left: 40, top: 20, width: 52, height: 40 };
  image = { left: 60, top: 24, width: 32, height: 32 };
  app.resize();
  app.flush();
  checkCenter();
  app.window.sineCleanup();
  assert.equal(properties.size, 0);
});

test("assignment changes and startup restore read the latest cache", () => {
  const app = browser(1);
  app.event("ZenWorkspaceDataChanged");
  app.workspace({ containerTabId: "7" });
  app.flush();
  assert.match(app.css(), /usercontextid="7"/);
  for (const workspace of [undefined, {}, { containerTabId: 0 }, { containerTabId: -1 }, { containerTabId: "invalid" }]) {
    app.workspace(workspace);
    app.event("ZenWorkspacesUIUpdate");
    app.flush();
    assert.equal(app.css(), "");
  }
  app.workspace({ containerTabId: 3 });
  app.event("AfterWorkspacesSessionRestore");
  app.flush();
  assert.match(app.css(), /usercontextid="3"/);
});

test("windows have independent state; reload and Sine unload clean up", () => {
  const first = browser(1);
  const second = browser(2);
  first.run();
  assert.equal(first.styles[0].removed, true);
  assert.equal(first.styles.length, 2);
  first.event("TabSelect");
  first.window.sineCleanup();
  first.flush();
  assert.equal(first.styles[1].removed, true);
  assert.equal(first.disconnected(), true);
  assert.equal(first.listenerCount(), 0);
  assert.equal(first.window.zenContainerDotCleanup, undefined);
  assert.match(second.css(), /usercontextid="2"/);
});

test("Sine manifest points to existing CSS and browser-only script", () => {
  const manifest = require("../theme.json");
  assert.ok(existsSync(`${__dirname}/../${manifest.style.chrome}`));
  assert.ok(existsSync(`${__dirname}/../src/${Object.keys(manifest.scripts.src)[0]}`));
  assert.deepEqual(manifest.scripts.src["container-dot.uc.js"].include, ["chrome://browser/content/browser.xhtml"]);
});

function measuredStack() {
  const properties = new Map();
  const fixture = { reads: 0 };
  const image = { left: 4, top: 2, width: 16, height: 16 };
  const rect = { left: 0, top: 0, width: 26, height: 20 };
  const icon = { getBoundingClientRect: () => { fixture.reads++; return image; } };
  const stack = {
    nodeType: 1,
    matches: selector => selector.includes(".tab-icon-stack"),
    querySelector: () => fixture.icon,
    querySelectorAll: () => [],
    getBoundingClientRect: () => { fixture.reads++; return rect; },
    style: {
      getPropertyValue: name => properties.get(name),
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: name => properties.delete(name),
    },
  };
  const tab = {
    closest: () => tab,
    querySelectorAll: () => [stack],
    matches: selector => selector.includes(".tabbrowser-tab"),
  };
  stack.closest = () => tab;
  icon.closest = () => tab;
  Object.assign(fixture, { stack, icon, tab, properties, image, rect });
  return fixture;
}

test("unrelated UI and our stylesheet mutations schedule no work", () => {
  const fixture = measuredStack();
  const app = browser(1, [fixture.stack]);
  const before = { ...app.stats };
  const toolbar = { closest: () => null, matches: () => false };
  app.mutate([
    { type: "attributes", attributeName: "class", target: toolbar },
    { type: "childList", target: toolbar, addedNodes: [{ nodeType: 3 }], removedNodes: [] },
    { type: "childList", target: app.styles[0], addedNodes: [{ nodeType: 3 }], removedNodes: [] },
  ]);
  app.flush();
  assert.deepEqual(app.stats, before);
  assert.equal(fixture.reads, 2);
});

test("selection and container assignment update matching without scanning or measuring", () => {
  const fixture = measuredStack();
  const app = browser(1, [fixture.stack]);
  for (const event of ["TabSelect", "ZenWorkspaceDataChanged"]) {
    app.workspace({ containerTabId: 7 });
    app.event(event, fixture.tab);
    app.flush();
  }
  assert.match(app.css(), /usercontextid="7"/);
  assert.equal(app.stats.scans, 1);
  assert.equal(fixture.reads, 2);
});

test("one icon resize among 100 tabs reads only its two rectangles", () => {
  const fixtures = Array.from({ length: 100 }, measuredStack);
  const app = browser(1, fixtures.map(fixture => fixture.stack));
  const before = { ...app.stats };
  app.resize([fixtures[42].stack, fixtures[42].icon]);
  app.resize([fixtures[42].icon]);
  app.flush();
  assert.equal(app.stats.scans, before.scans);
  assert.equal(app.stats.workspaceReads, before.workspaceReads);
  assert.equal(app.stats.timers - before.timers, 1);
  assert.equal(fixtures.reduce((sum, fixture) => sum + fixture.reads, 0), 202);
  assert.equal(fixtures[42].reads, 4);
});

test("tab insertion/removal, container changes, and icon replacement maintain observations", () => {
  const first = measuredStack(), second = measuredStack();
  const icons = [first.stack];
  const app = browser(1, icons);
  const parent = { closest: () => null };
  function structure(addedNodes, removedNodes) {
    app.mutate([{ type: "childList", target: parent, addedNodes, removedNodes }]);
    app.flush();
  }
  icons.push(second.stack);
  structure([second.stack], []);
  assert.equal(second.reads, 2);
  assert.equal(first.reads, 2);
  assert.equal(app.observed.size, 4);

  const oldIcon = second.icon;
  second.icon = { getBoundingClientRect: () => ({ left: 6, top: 2, width: 16, height: 16 }) };
  app.mutate([{ type: "childList", target: second.tab, addedNodes: [second.stack], removedNodes: [] }]);
  app.flush();
  assert.equal(app.observed.has(oldIcon), false);
  assert.equal(app.observed.has(second.icon), true);

  icons.splice(0, 1); // Simulate changing the first tab to No Container.
  app.mutate([{ type: "attributes", target: first.tab, attributeName: "usercontextid" }]);
  app.flush();
  assert.equal(first.properties.size, 0);
  assert.equal(app.observed.has(first.stack), false);
  icons.pop();
  structure([], [second.stack]);
  assert.equal(second.properties.size, 0);
  assert.equal(app.observed.size, 0);
});

test("pinning targets one tab; workspace/sidebar transitions refresh existing positions", () => {
  const first = measuredStack(), second = measuredStack();
  const app = browser(1, [first.stack, second.stack]);
  first.image.left = 8;
  app.event("TabPinned", first.tab);
  app.event("TabUnpinned", first.tab);
  app.flush();
  assert.equal(first.reads, 4);
  assert.equal(second.reads, 2);
  assert.equal(app.stats.scans, 1);
  app.workspace({ containerTabId: 8 });
  app.mutate();
  app.flush();
  assert.match(app.css(), /usercontextid="8"/);
  assert.equal(first.reads, 6);
  assert.equal(second.reads, 4);
  app.mutate([{ type: "attributes", attributeName: "zen-sidebar-expanded", target: { id: "navigator-toolbox" } }]);
  app.flush();
  assert.equal(first.reads, 8);
  assert.equal(second.reads, 6);
  assert.equal(app.stats.scans, 1);
  app.window.sineCleanup();
  assert.equal(app.observed.size, 0);
});

test("moving an existing tab refreshes alignment even when its size stays constant", () => {
  const first = measuredStack(), second = measuredStack();
  const app = browser(1, [first.stack, second.stack]);
  first.image.left = 10;
  app.mutate([{
    type: "childList", target: { closest: () => null },
    addedNodes: [first.stack], removedNodes: [],
  }]);
  app.flush();
  assert.equal(first.reads, 4);
  assert.equal(second.reads, 2);
  const x = parseFloat(first.properties.get("--zen-container-dot-x")) / 100 * first.rect.width;
  assert.ok(Math.abs(x - 18) < 0.001);
});
