const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const vm = require("node:vm");

const script = readFileSync(`${__dirname}/../src/container-dot.uc.js`, "utf8");

function browser(containerTabId) {
  const listeners = new Map();
  const styles = [];
  let workspace = { containerTabId };
  let mutationCallback;
  let pending;
  let disconnected = false;
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
  };
  const context = vm.createContext({
    window, document,
    MutationObserver: class {
      constructor(fn) { mutationCallback = fn; }
      observe() {}
      disconnect() { disconnected = true; }
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
