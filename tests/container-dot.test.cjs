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
  const window = {
    location: { href: "chrome://browser/content/browser.xhtml" },
    gZenWorkspaces: { getActiveWorkspaceFromCache: () => workspace },
    setTimeout: fn => { pending = fn; return 1; },
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
    querySelectorAll: () => iconStacks,
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
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  const run = () => vm.runInContext(script, context);
  run();
  return {
    window, styles, run,
    css: () => styles.at(-1).textContent,
    workspace: value => { workspace = value; },
    event: name => { for (const fn of listeners.get(name) ?? []) fn(); },
    mutate: () => mutationCallback(),
    resize: () => resizeCallback(),
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
