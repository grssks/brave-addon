"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = __dirname;

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
assert.strictEqual(manifest.manifest_version, 3);
assert.ok(/^\d+\.\d+\.\d+$/.test(manifest.version), "manifest.version must be semver");
assert.strictEqual(manifest.name, "Brave Addon");
assert.ok(manifest.permissions.includes("declarativeNetRequest"), "manifest must declare declarativeNetRequest");
assert.strictEqual(manifest.declarative_net_request.rule_resources[0].id, "ruleset_client_hints");
assert.ok(Array.isArray(manifest.content_scripts) && manifest.content_scripts.length === 2);
assert.strictEqual(manifest.content_scripts[0].world, "MAIN");
assert.strictEqual(manifest.content_scripts[0].run_at, "document_start");
assert.strictEqual(manifest.content_scripts[0].match_origin_as_fallback, true);
assert.strictEqual(manifest.content_scripts[1].world, "ISOLATED");
assert.strictEqual(manifest.content_scripts[1].run_at, "document_start");
assert.strictEqual(manifest.content_scripts[1].match_origin_as_fallback, true);

function createSimEnv() {
  let nativeHidden = false;
  let nowMs = 1000;
  let nativeTimerSeq = 10000;
  const nativeTimers = new Map();
  const elementsById = new Map();

  class EventTargetSim {
    constructor() {
      this._listeners = new Map();
    }
    addEventListener(type, fn, capture) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push({ fn, capture: Boolean(capture) });
    }
    removeEventListener(type, fn, capture) {
      const list = this._listeners.get(type);
      if (!list) return;
      this._listeners.set(
        type,
        list.filter((entry) => entry.fn !== fn || entry.capture !== Boolean(capture))
      );
    }
    dispatchEvent(event) {
      if (!event.target) event.target = this;
      const list = (this._listeners.get(event.type) || []).slice();
      for (const entry of list) {
        if (event._stopImmediate) break;
        entry.fn.call(this, event);
      }
      return !event.defaultPrevented;
    }
  }

  class CustomEventSim {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
      this.target = init.target || null;
      this.defaultPrevented = false;
      this._stopProp = false;
      this._stopImmediate = false;
    }
    stopPropagation() {
      this._stopProp = true;
    }
    stopImmediatePropagation() {
      this._stopImmediate = true;
      this._stopProp = true;
    }
    preventDefault() {
      this.defaultPrevented = true;
    }
  }

  class ElementSim extends EventTargetSim {
    constructor(tagName, attrs = {}) {
      super();
      this.nodeType = 1;
      this.tagName = tagName.toUpperCase();
      this._id = attrs.id || "";
      this.className = attrs.className || "";
      this.textContent = attrs.textContent || "";
      this.style = attrs.style || {};
      this.isContentEditable = Boolean(attrs.isContentEditable);
      this._children = [];
      this.parentElement = null;
      this._attrs = new Map(Object.entries(attrs.attrs || {}));
      this.classList = {
        contains: (c) => this.className.split(/\s+/).includes(c)
      };
    }
    get id() {
      return this._id;
    }
    set id(val) {
      if (this._id) elementsById.delete(this._id);
      this._id = val;
      if (val) elementsById.set(val, this);
    }
    appendChild(child) {
      child.parentElement = this;
      this._children.push(child);
      if (child.id) elementsById.set(child.id, child);
      return child;
    }
    remove() {
      if (this.id) elementsById.delete(this.id);
      if (this.parentElement) {
        this.parentElement._children = this.parentElement._children.filter((c) => c !== this);
        this.parentElement = null;
      }
    }
    get children() {
      return this._children;
    }
    getAttribute(name) {
      return this._attrs.has(name) ? this._attrs.get(name) : null;
    }
    hasAttribute(name) {
      return this._attrs.has(name);
    }
    removeAttribute(name) {
      this._attrs.delete(name);
    }
    getBoundingClientRect() {
      return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 };
    }
    checkVisibility() {
      return false;
    }
  }

  class HTMLElementSim extends ElementSim {
    get offsetParent() {
      return null;
    }
    get offsetHeight() {
      return 0;
    }
    get offsetWidth() {
      return 0;
    }
    get clientHeight() {
      return 0;
    }
    get clientWidth() {
      return 0;
    }
  }

  class DocumentSim extends EventTargetSim {
    constructor() {
      super();
      this.readyState = "loading";
      this.documentElement = new HTMLElementSim("html");
      this.head = new HTMLElementSim("head");
      this.body = new HTMLElementSim("body");
      this.documentElement.appendChild(this.head);
      this.documentElement.appendChild(this.body);
    }
    get hidden() {
      return nativeHidden;
    }
    get webkitHidden() {
      return nativeHidden;
    }
    get visibilityState() {
      return nativeHidden ? "hidden" : "visible";
    }
    get webkitVisibilityState() {
      return nativeHidden ? "hidden" : "visible";
    }
    hasFocus() {
      return !nativeHidden;
    }
    createElement(tag) {
      return new HTMLElementSim(tag);
    }
    getElementById(id) {
      return elementsById.get(id) || null;
    }
    querySelectorAll() {
      return [];
    }
  }

  class WindowSim extends EventTargetSim {
    constructor() {
      super();
      this.location = { hostname: "example.com", pathname: "/test", protocol: "https:" };
      this.performance = { now: () => nowMs };
      this.setTimeout = (fn, delay) => {
        const id = nativeTimerSeq++;
        nativeTimers.set(id, { fn, delay, isInterval: false });
        return id;
      };
      this.clearTimeout = (id) => nativeTimers.delete(id);
      this.setInterval = (fn, delay) => {
        const id = nativeTimerSeq++;
        nativeTimers.set(id, { fn, delay, isInterval: true });
        return id;
      };
      this.clearInterval = (id) => nativeTimers.delete(id);
      this.requestAnimationFrame = (cb) => {
        const id = nativeTimerSeq++;
        nativeTimers.set(id, { fn: cb, isRaf: true });
        return id;
      };
      this.cancelAnimationFrame = (id) => nativeTimers.delete(id);
      this.fetch = (url) => Promise.reject(new Error(`Network blocked: ${url}`));
      this.getComputedStyle = (el) => ({
        display: "none",
        visibility: "hidden",
        opacity: "0",
        position: (el && el.style && el.style.position) || "static",
        zIndex: "0",
        width: "0px",
        height: "0px",
        getPropertyValue: (p) => (p === "display" ? "none" : p === "visibility" ? "hidden" : p === "opacity" ? "0" : "0px")
      });
    }
  }

  const tickCtrlEvents = [];
  class XMLHttpRequestSim extends EventTargetSim {
    open(method, url) {
      this._url = url;
      this.status = 0;
    }
    send() {}
  }

  class WorkerSim {
    constructor(url) {
      this.url = url;
      WorkerSim.lastInstance = this;
    }
    terminate() {
      this.terminated = true;
    }
  }

  const win = new WindowSim();
  win.location = {
    hostname: "example.com",
    pathname: "/test",
    protocol: "https:",
    origin: "https://example.com",
    href: "https://example.com/test"
  };
  const doc = new DocumentSim();
  doc.addEventListener("__brave_addon_tick_ctrl__", (e) => {
    tickCtrlEvents.push(Boolean(e && e.detail && e.detail.active));
  });
  win.document = doc;
  win.window = win;
  win.self = win;
  win.top = win;
  win.Document = DocumentSim;
  win.Element = ElementSim;
  win.HTMLElement = HTMLElementSim;
  win.XMLHttpRequest = XMLHttpRequestSim;
  win.Worker = WorkerSim;
  win.Blob = class BlobSim {};
  win.URL = class URLSim extends URL {
    static createObjectURL() {
      return "blob:https://example.com/tick";
    }
    static revokeObjectURL() {}
  };
  win.Event = CustomEventSim;
  win.CustomEvent = CustomEventSim;
  win.Response = class ResponseSim {
    constructor(body, init = {}) {
      this.body = body;
      this.status = init.status || 200;
      this.ok = this.status >= 200 && this.status < 300;
    }
  };

  const context = vm.createContext(win);
  context.global = win;
  const code = fs.readFileSync(path.join(ROOT, "main-world.js"), "utf8");
  vm.runInContext(code, context, { filename: "main-world.js" });

  return {
    win,
    doc,
    context,
    HTMLElementSim,
    XMLHttpRequestSim,
    WorkerSim,
    tickCtrlEvents,
    CustomEventSim,
    nativeTimers,
    setNativeHidden: (v) => {
      nativeHidden = v;
    },
    advanceNow: (ms) => {
      nowMs += ms;
    }
  };
}

async function runTests() {
  const env = createSimEnv();
  const { win, doc, context, HTMLElementSim, XMLHttpRequestSim, WorkerSim, tickCtrlEvents, CustomEventSim, nativeTimers, setNativeHidden, advanceNow } = env;

  // Anti-adblock checks
  const bait = new HTMLElementSim("div", { className: "adsbox" });
  assert.strictEqual(bait.offsetHeight, 250, "Collapsed .adsbox should report offsetHeight 250");
  assert.strictEqual(bait.getBoundingClientRect().height, 250, "Collapsed .adsbox rect height should be 250");
  assert.strictEqual(win.getComputedStyle(bait).display, "block", "Hidden .adsbox computed display should be block");

  const normalCollapsed = new HTMLElementSim("div", { className: "content" });
  assert.strictEqual(normalCollapsed.offsetHeight, 0, "Normal collapsed element must still return 0");

  const baitWithText = new HTMLElementSim("div", {
    className: "adsbox",
    textContent: "This is a real content container with more than 24 characters."
  });
  assert.strictEqual(baitWithText.offsetHeight, 0, "Element with >=24 chars must not be spoofed");

  const adRes = await win.fetch("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js");
  assert.strictEqual(adRes.status, 200, "Ad probe fetch failure should resolve 200");

  await assert.rejects(
    () => win.fetch("https://example.com/api/data"),
    /Network blocked/,
    "Non-ad fetch failure must still reject"
  );

  let notDetectedFired = false;
  win.fuckAdBlock.onNotDetected(() => {
    notDetectedFired = true;
  });
  for (const [, t] of Array.from(nativeTimers.entries())) {
    if (t.delay === 0) t.fn();
  }
  assert.strictEqual(notDetectedFired, true, "fuckAdBlock.onNotDetected callback should fire");

  assert.strictEqual(
    vm.runInContext("Function.prototype.toString.call(document.hasFocus)", context),
    "function hasFocus() { [native code] }",
    "Function.prototype.toString must mask patched hasFocus"
  );

  // Copy and right-click unlock checks
  doc.dispatchEvent(new CustomEventSim("DOMContentLoaded"));
  assert.ok(doc.getElementById("__brave_addon_unlock_css__"), "Unlock CSS should be injected when enabled");

  const ctxEvt = new CustomEventSim("contextmenu", { target: new HTMLElementSim("div") });
  win.dispatchEvent(ctxEvt);
  assert.strictEqual(ctxEvt._stopProp, true, "contextmenu should stopPropagation when enabled");
  assert.strictEqual(ctxEvt._stopImmediate, true, "contextmenu should stopImmediatePropagation when enabled");

  const inputPaste = new CustomEventSim("paste", { target: new HTMLElementSim("input") });
  win.dispatchEvent(inputPaste);
  assert.strictEqual(inputPaste._stopProp, true, "paste on <input> should stopPropagation");

  const editorPaste = new CustomEventSim("paste", {
    target: new HTMLElementSim("div", { isContentEditable: true })
  });
  win.dispatchEvent(editorPaste);
  assert.strictEqual(editorPaste._stopProp, false, "paste on contenteditable must NOT stopPropagation");

  doc.dispatchEvent(
    new CustomEventSim("__brave_addon_config__", {
      detail: { antiAdblock: true, unlockInteraction: false, keepAlive: true }
    })
  );
  assert.strictEqual(doc.getElementById("__brave_addon_unlock_css__"), null, "Unlock CSS should be removed when disabled");
  const ctxEvtOff = new CustomEventSim("contextmenu", { target: new HTMLElementSim("div") });
  win.dispatchEvent(ctxEvtOff);
  assert.strictEqual(ctxEvtOff._stopProp, false, "contextmenu must not stopPropagation when disabled");

  // Background keep-alive checks
  setNativeHidden(true);
  const visEvt = new CustomEventSim("visibilitychange", { target: doc });
  doc.dispatchEvent(visEvt);
  assert.strictEqual(visEvt._stopImmediate, true, "visibilitychange should be suppressed when keepAlive is on");
  assert.strictEqual(doc.hidden, false, "document.hidden must spoof false");
  assert.strictEqual(doc.visibilityState, "visible", "document.visibilityState must spoof visible");
  assert.strictEqual(doc.hasFocus(), true, "document.hasFocus() must spoof true");

  const winBlur = new CustomEventSim("blur", { target: vm.runInContext("window", context) });
  win.dispatchEvent(winBlur);
  assert.strictEqual(winBlur._stopImmediate, true, "window blur must be suppressed");

  const inputBlur = new CustomEventSim("blur", { target: new HTMLElementSim("input") });
  win.dispatchEvent(inputBlur);
  assert.strictEqual(inputBlur._stopImmediate, false, "input blur must NOT be suppressed");

  let intervalTicks = 0;
  let rafFired = 0;
  const ivId = win.setInterval(() => {
    intervalTicks++;
  }, 1000);
  win.requestAnimationFrame(() => {
    rafFired++;
  });

  advanceNow(1050);
  doc.dispatchEvent(new CustomEventSim("__brave_addon_tick__"));
  assert.strictEqual(intervalTicks, 1, "Background setInterval should fire after 1050ms");
  assert.strictEqual(rafFired, 1, "Background rAF should fire on tick");

  win.clearInterval(ivId);
  advanceNow(1050);
  doc.dispatchEvent(new CustomEventSim("__brave_addon_tick__"));
  assert.strictEqual(intervalTicks, 1, "Cleared interval must not fire again");

  doc.dispatchEvent(
    new CustomEventSim("__brave_addon_config__", {
      detail: { antiAdblock: true, unlockInteraction: false, keepAlive: false }
    })
  );
  assert.strictEqual(doc.hidden, true, "document.hidden must restore native value when keepAlive is disabled");
  assert.strictEqual(doc.visibilityState, "hidden", "document.visibilityState must restore native value");

  setNativeHidden(false);
  doc.dispatchEvent(new CustomEventSim("visibilitychange", { target: doc }));

  // Edge cases and hardening checks
  const shortFn = () => {};
  const strId = win.setTimeout(shortFn, 50);
  assert.ok(strId >= 10000 && strId < 1000000, "Short foreground setTimeout (<500ms) must return native ID directly");
  assert.strictEqual(nativeTimers.get(strId).fn, shortFn, "Short foreground setTimeout must pass fn directly without wrapper");
  win.clearTimeout(String(strId));
  assert.strictEqual(nativeTimers.has(strId), false, "clearTimeout(String(id)) must cancel native timer");

  const longId = win.setTimeout(() => {}, 1000);
  assert.ok(longId >= 1000000, "Long setTimeout (>=500ms) must be tracked with virtual ID");
  win.clearTimeout(String(longId));
  assert.strictEqual(
    Array.from(nativeTimers.values()).some((t) => t.delay === 1000 && !t.isInterval),
    false,
    "clearTimeout(String(longId)) must cancel tracked timer"
  );

  doc.dispatchEvent(
    new CustomEventSim("__brave_addon_config__", {
      detail: { unlockInteraction: true }
    })
  );
  const ctrlVInput = new CustomEventSim("keydown", {
    target: new HTMLElementSim("input")
  });
  ctrlVInput.ctrlKey = true;
  ctrlVInput.key = "v";
  win.dispatchEvent(ctrlVInput);
  assert.strictEqual(ctrlVInput._stopProp, true, "Ctrl+V on <input> should stopPropagation");

  const ctrlVEditable = new CustomEventSim("keydown", {
    target: new HTMLElementSim("div", { isContentEditable: true })
  });
  ctrlVEditable.ctrlKey = true;
  ctrlVEditable.key = "v";
  win.dispatchEvent(ctrlVEditable);
  assert.strictEqual(ctrlVEditable._stopProp, false, "Ctrl+V on contenteditable must NOT stopPropagation");

  const adXhr = new XMLHttpRequestSim();
  let adXhrLoaded = false;
  adXhr.addEventListener("load", () => {
    adXhrLoaded = true;
  });
  adXhr.open("GET", "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js");
  adXhr.send();
  adXhr.dispatchEvent(new CustomEventSim("error"));
  assert.strictEqual(adXhr.status, 200, "Ad-probe XHR error must synthesize status 200");
  assert.strictEqual(adXhrLoaded, true, "Ad-probe XHR error must fire load event");

  const apiXhr = new XMLHttpRequestSim();
  let apiXhrLoaded = false;
  apiXhr.addEventListener("load", () => {
    apiXhrLoaded = true;
  });
  apiXhr.open("GET", "https://example.com/api/status");
  apiXhr.send();
  apiXhr.dispatchEvent(new CustomEventSim("error"));
  assert.strictEqual(apiXhr.status, 0, "Non-ad XHR error must keep status 0");
  assert.strictEqual(apiXhrLoaded, false, "Non-ad XHR error must not synthesize load");

  tickCtrlEvents.length = 0;
  setNativeHidden(true);
  doc.dispatchEvent(
    new CustomEventSim("__brave_addon_config__", {
      detail: { keepAlive: true, antiAdblock: false }
    })
  );
  doc.dispatchEvent(new CustomEventSim("visibilitychange", { target: doc }));
  assert.strictEqual(tickCtrlEvents.length, 0, "Hidden tab with 0 timers must NOT start background ticker");
  const keepAliveTimerId = win.setTimeout(() => {}, 2000);
  assert.strictEqual(tickCtrlEvents[tickCtrlEvents.length - 1], true, "Scheduling timer in hidden mode must start background ticker");
  win.clearTimeout(keepAliveTimerId);
  assert.strictEqual(tickCtrlEvents[tickCtrlEvents.length - 1], false, "Clearing last timer in hidden mode must stop background ticker");

  assert.strictEqual("canRunAds" in win, false, "canRunAds mock must be cleaned up when antiAdblock is disabled");
  assert.strictEqual("fuckAdBlock" in win, false, "fuckAdBlock mock must be cleaned up when antiAdblock is disabled");

  doc.dispatchEvent(
    new CustomEventSim("__brave_addon_config__", {
      detail: { antiAdblock: true }
    })
  );
  const textAdBait = new HTMLElementSim("div", { className: "textAd" });
  assert.strictEqual(textAdBait.offsetHeight, 250, ".textAd bait should report offsetHeight 250");
  assert.strictEqual(win.getComputedStyle(textAdBait).opacity, "1", ".textAd computed opacity should be 1");

  const imgProbe = new HTMLElementSim("img");
  imgProbe.src = "https://www.highperformanceformat.com/abc123/invoke.js";
  let imgProbeLoaded = false;
  imgProbe.addEventListener("load", () => {
    imgProbeLoaded = true;
  });
  const imgErrEvt = new CustomEventSim("error", { target: imgProbe });
  win.dispatchEvent(imgErrEvt);
  assert.strictEqual(imgErrEvt._stopImmediate, true, "<img> ad probe error must be suppressed");
  assert.strictEqual(imgProbeLoaded, true, "<img> ad probe error must synthesize load");

  doc.body.style.overflow = "hidden";
  const wallOverlay = new HTMLElementSim("div", {
    className: "rnd-xyz-991",
    style: { position: "fixed" },
    textContent: "Please turn off your ad blocker. Ads keep this link free. I HAVE TURNED IT OFF"
  });
  const normalArticle = new HTMLElementSim("article", {
    className: "post-content",
    textContent: "Please turn off your ad blocker is a common message on shortlink sites."
  });
  doc.body.appendChild(wallOverlay);
  doc.body.appendChild(normalArticle);

  doc.dispatchEvent(
    new CustomEventSim("__brave_addon_config__", {
      detail: { antiAdblock: true }
    })
  );
  assert.strictEqual(doc.body.children.includes(wallOverlay), false, "Fixed anti-adblock wall must be removed");
  assert.strictEqual(doc.body.children.includes(normalArticle), true, "Normal <article> must NOT be removed");
  assert.strictEqual(doc.body.style.overflow, "", "Body scroll lock must be cleared after wall removal");

  const unknownNoCors = await win.fetch("https://unknown-rotating-ad.xyz/p.js", { mode: "no-cors" });
  assert.strictEqual(unknownNoCors.status, 200, "Cross-origin no-cors fetch failure must resolve 200");

  await assert.rejects(
    () => win.fetch("https://example.com/api", { mode: "no-cors" }),
    /Network blocked/,
    "Same-origin no-cors fetch failure must still reject"
  );
  await assert.rejects(
    () => win.fetch("https://api.other.com/data", { mode: "cors" }),
    /Network blocked/,
    "Cross-origin cors fetch failure must still reject"
  );

  const tinyCrossImg = new HTMLElementSim("img");
  tinyCrossImg.src = "https://cdn-other.xyz/pixel.gif";
  tinyCrossImg.width = 1;
  tinyCrossImg.height = 1;
  let tinyImgLoaded = false;
  tinyCrossImg.addEventListener("load", () => {
    tinyImgLoaded = true;
  });
  const tinyErrEvt = new CustomEventSim("error", { target: tinyCrossImg });
  win.dispatchEvent(tinyErrEvt);
  assert.strictEqual(tinyErrEvt._stopImmediate, true, "1x1 cross-origin <img> error must be suppressed");
  assert.strictEqual(tinyImgLoaded, true, "1x1 cross-origin <img> error must synthesize load");

  const visibleCrossImg = new HTMLElementSim("img");
  visibleCrossImg.src = "https://cdn-other.xyz/photo.jpg";
  visibleCrossImg.width = 400;
  visibleCrossImg.height = 300;
  const visibleErrEvt = new CustomEventSim("error", { target: visibleCrossImg });
  win.dispatchEvent(visibleErrEvt);
  assert.strictEqual(visibleErrEvt._stopImmediate, false, "Visible 400x300 <img> error must NOT be suppressed");

  const adsDiv = new HTMLElementSim("div", { className: "ads" });
  adsDiv.isConnected = true;
  assert.strictEqual(adsDiv.offsetParent, doc.body, "Collapsed .ads bait must spoof offsetParent");
  assert.strictEqual(adsDiv.checkVisibility(), true, "Collapsed .ads bait must spoof checkVisibility()");

  const normalModal = new HTMLElementSim("div", { className: "modal" });
  normalModal.isConnected = true;
  assert.strictEqual(normalModal.offsetParent, null, "Normal collapsed .modal must keep offsetParent === null");
  assert.strictEqual(normalModal.checkVisibility(), false, "Normal collapsed .modal must keep checkVisibility() === false");

  const adScript = new HTMLElementSim("script");
  adScript.src = "https://random-ad-network-99.xyz/tag.js";
  let adScriptLoaded = false;
  adScript.addEventListener("load", () => {
    adScriptLoaded = true;
  });
  const adScriptErr = new CustomEventSim("error", { target: adScript });
  win.dispatchEvent(adScriptErr);
  assert.strictEqual(adScriptErr._stopImmediate, true, "Cross-origin non-CDN <script> error must be suppressed");
  assert.strictEqual(adScriptLoaded, true, "Cross-origin non-CDN <script> error must synthesize load");

  const cdnScript = new HTMLElementSim("script");
  cdnScript.src = "https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.js";
  const cdnScriptErr = new CustomEventSim("error", { target: cdnScript });
  win.dispatchEvent(cdnScriptErr);
  assert.strictEqual(cdnScriptErr._stopImmediate, false, "Legitimate CDN <script> error must NOT be suppressed");

  const mapsScript = new HTMLElementSim("script");
  mapsScript.src = "https://maps.googleapis.com/maps/api/js";
  const mapsScriptErr = new CustomEventSim("error", { target: mapsScript });
  win.dispatchEvent(mapsScriptErr);
  assert.strictEqual(mapsScriptErr._stopImmediate, false, "Google Maps SDK <script> error must NOT be suppressed");

  const dragCard = new HTMLElementSim("div", { attrs: { draggable: "true" } });
  const dragEvt = new CustomEventSim("dragstart", { target: dragCard });
  win.dispatchEvent(dragEvt);
  assert.strictEqual(dragEvt._stopImmediate, false, "dragstart on [draggable='true'] must NOT be blocked");

  const canvasEl = new HTMLElementSim("canvas");
  const canvasCtx = new CustomEventSim("contextmenu", { target: canvasEl });
  win.dispatchEvent(canvasCtx);
  assert.strictEqual(canvasCtx._stopImmediate, false, "contextmenu on <canvas> must NOT be blocked");

  const appRoot = new HTMLElementSim("div", { attrs: { role: "application" } });
  const appChild = new HTMLElementSim("div");
  appRoot.appendChild(appChild);
  const appCtx = new CustomEventSim("contextmenu", { target: appChild });
  win.dispatchEvent(appCtx);
  assert.strictEqual(appCtx._stopImmediate, false, "contextmenu inside [role='application'] must NOT be blocked");

  const firstPartySubScript = new HTMLElementSim("script");
  firstPartySubScript.src = "https://static.example.com/app.js";
  const fpSubErr = new CustomEventSim("error", { target: firstPartySubScript });
  win.dispatchEvent(fpSubErr);
  assert.strictEqual(fpSubErr._stopImmediate, false, "First-party subdomain <script> error must NOT be suppressed");

  await assert.rejects(
    () => win.fetch("https://static.example.com/ping", { mode: "no-cors" }),
    /Network blocked/,
    "First-party subdomain no-cors fetch failure must still reject"
  );

  await testBraveCloak();

  console.log("All Brave Addon tests passed.");
}

async function testBraveCloak() {
  const runCase = ({ brands, fullVersionList, workerThrowsBlob = false }) => {
    class NavigatorSim {}
    NavigatorSim.prototype.brave = { isBrave: async () => true };

    class NavigatorUADataSim {
      get brands() {
        return brands;
      }
      toJSON() {
        return { brands: this.brands, mobile: false, platform: "Windows" };
      }
      async getHighEntropyValues(hints) {
        const out = { mobile: false, platform: "Windows" };
        if (hints.includes("brands")) out.brands = this.brands;
        if (hints.includes("fullVersionList")) out.fullVersionList = fullVersionList;
        return out;
      }
    }

    const nav = new NavigatorSim();
    nav.brave = { isBrave: async () => true };
    nav.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
    nav.userAgentData = new NavigatorUADataSim();

    const revokedUrls = [];
    const createdBlobs = [];
    class WorkerSim {
      constructor(url) {
        if (workerThrowsBlob && String(url).startsWith("blob:")) {
          throw new Error("Refused to create a worker from 'blob:' due to CSP");
        }
        this.url = url;
      }
    }

    const docListeners = new Map();
    const docSim = {
      readyState: "complete",
      documentElement: { style: {} },
      head: { appendChild: () => {} },
      body: { style: {} },
      addEventListener: (t, fn) => {
        if (!docListeners.has(t)) docListeners.set(t, []);
        docListeners.get(t).push(fn);
      },
      dispatchEvent: (e) => {
        for (const fn of docListeners.get(e.type) || []) fn(e);
        return true;
      },
      getElementById: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {} })
    };

    const sandbox = {
      location: { hostname: "example.com", pathname: "/", href: "https://example.com/" },
      document: docSim,
      Navigator: NavigatorSim,
      NavigatorUAData: NavigatorUADataSim,
      navigator: nav,
      Worker: WorkerSim,
      Blob: class {
        constructor(parts) {
          createdBlobs.push(parts.join(""));
        }
      },
      URL: class extends URL {
        static createObjectURL() {
          return "blob:https://example.com/cloak-worker";
        }
        static revokeObjectURL(u) {
          revokedUrls.push(u);
        }
      },
      HTMLIFrameElement: class {
        get contentWindow() {
          return null;
        }
        get contentDocument() {
          return null;
        }
      },
      CustomEvent: class {
        constructor(t, i) {
          this.type = t;
          this.detail = i && i.detail;
        }
      },
      setTimeout: () => 0,
      clearTimeout: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      addEventListener: () => {},
      dispatchEvent: () => true,
      performance: { now: () => 0 }
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.top = sandbox;
    const ctx = vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "main-world.js"), "utf8"), ctx, { filename: "main-world.js" });
    return { sandbox, ctx, revokedUrls, createdBlobs, docSim };
  };

  // Brave present in brands list
  const caseA = runCase({
    brands: [
      { brand: "Chromium", version: "136" },
      { brand: "Brave", version: "136" },
      { brand: "Not.A/Brand", version: "99" }
    ],
    fullVersionList: [
      { brand: "Chromium", version: "136.0.0.0" },
      { brand: "Brave", version: "136.0.0.0" },
      { brand: "Not.A/Brand", version: "99.0.0.0" }
    ]
  });
  assert.strictEqual("brave" in caseA.sandbox.navigator, false, "navigator.brave must be deleted");
  assert.ok(caseA.sandbox.navigator.userAgentData.brands.some((b) => b.brand === "Google Chrome" && b.version === "136"));
  assert.strictEqual(caseA.sandbox.navigator.userAgentData.brands.some((b) => /brave/i.test(b.brand)), false);
  assert.ok(caseA.sandbox.navigator.userAgentData.toJSON().brands.some((b) => b.brand === "Google Chrome"));
  const highA = await caseA.sandbox.navigator.userAgentData.getHighEntropyValues(["fullVersionList"]);
  assert.ok(highA.fullVersionList.some((b) => b.brand === "Google Chrome" && b.version === "136.0.0.0"));
  assert.strictEqual(
    vm.runInContext("Function.prototype.toString.call(Object.getOwnPropertyDescriptor(NavigatorUAData.prototype, 'brands').get)", caseA.ctx),
    "function get brands() { [native code] }"
  );
  assert.strictEqual(
    vm.runInContext("Function.prototype.toString.call(Worker)", caseA.ctx),
    "function Worker() { [native code] }"
  );
  const w1 = vm.runInContext("new Worker('/app/w.js')", caseA.ctx);
  assert.strictEqual(w1.url, "blob:https://example.com/cloak-worker");

  const wBlob = vm.runInContext("new Worker('blob:https://example.com/existing')", caseA.ctx);
  assert.strictEqual(wBlob.url, "blob:https://example.com/existing", "Existing blob: Worker must not be re-wrapped");

  const bootstrapCode = caseA.createdBlobs[caseA.createdBlobs.length - 1];
  assert.ok(bootstrapCode && bootstrapCode.includes("https://example.com/app/w.js"));
  const fetchedUrls = [];
  const importedUrls = [];
  const workerCtx = vm.createContext({
    URL,
    importScripts: (...args) => importedUrls.push(...args),
    fetch: (u) => {
      fetchedUrls.push(u);
      return Promise.resolve();
    }
  });
  workerCtx.self = workerCtx;
  vm.runInContext(bootstrapCode.replace(/importScripts\("https:\/\/example\.com\/app\/w\.js"\);\s*$/, ""), workerCtx);
  workerCtx.fetch("./data.wasm");
  workerCtx.importScripts("./helper.js");
  assert.strictEqual(fetchedUrls[0], "https://example.com/app/data.wasm", "Worker fetch must resolve relative URL against script base");
  assert.strictEqual(importedUrls[0], "https://example.com/app/helper.js", "Worker importScripts must resolve relative URL against script base");

  caseA.docSim.dispatchEvent(new caseA.sandbox.CustomEvent("__brave_addon_config__", { detail: { braveCloak: false } }));
  assert.strictEqual("brave" in caseA.sandbox.navigator, true, "Disabling braveCloak must restore navigator.brave");
  caseA.docSim.dispatchEvent(new caseA.sandbox.CustomEvent("__brave_addon_config__", { detail: { braveCloak: true } }));
  assert.strictEqual("brave" in caseA.sandbox.navigator, false, "Re-enabling braveCloak must remove navigator.brave again");

  // Brave omitted: insert Google Chrome and verify Worker CSP fallback
  const caseB = runCase({
    brands: [
      { brand: "Chromium", version: "136" },
      { brand: "Not.A/Brand", version: "99" }
    ],
    fullVersionList: [
      { brand: "Chromium", version: "136.0.0.0" },
      { brand: "Not.A/Brand", version: "99.0.0.0" }
    ],
    workerThrowsBlob: true
  });
  assert.ok(caseB.sandbox.navigator.userAgentData.brands.some((b) => b.brand === "Google Chrome" && b.version === "136"));
  const highB = await caseB.sandbox.navigator.userAgentData.getHighEntropyValues(["fullVersionList"]);
  assert.ok(highB.fullVersionList.some((b) => b.brand === "Google Chrome" && b.version === "136.0.0.0"));
  const w2 = vm.runInContext("new Worker('/w.js')", caseB.ctx);
  assert.strictEqual(w2.url, "/w.js");
  assert.strictEqual(caseB.revokedUrls.length, 1);
  const w3 = vm.runInContext("new Worker('/w2.js')", caseB.ctx);
  assert.strictEqual(w3.url, "/w2.js");
  assert.strictEqual(caseB.revokedUrls.length, 1, "Subsequent Worker after CSP block must bypass blob creation");

  // background.js DNR rule generation with per-site exclusion
  let updatedDynamic = null;
  let disabledRulesets = null;
  const bgSandbox = {
    URL,
    setInterval,
    clearInterval,
    navigator: {
      userAgent: "Mozilla/5.0 Chrome/136.0.0.0 Safari/537.36",
      userAgentData: {
        brands: [
          { brand: "Chromium", version: "136" },
          { brand: "Not.A/Brand", version: "99" }
        ],
        getHighEntropyValues: async () => ({
          fullVersionList: [
            { brand: "Chromium", version: "136.0.0.0" },
            { brand: "Not.A/Brand", version: "99.0.0.0" }
          ]
        })
      }
    },
    chrome: {
      storage: {
        local: {
          get: async () => ({
            global: { braveCloak: true },
            sites: { "disabled.example.com": { braveCloak: false } }
          })
        },
        onChanged: { addListener: () => {} }
      },
      runtime: {
        onInstalled: { addListener: () => {} },
        onStartup: { addListener: () => {} },
        onConnect: { addListener: () => {} }
      },
      declarativeNetRequest: {
        updateDynamicRules: async (opts) => {
          updatedDynamic = opts;
        },
        updateEnabledRulesets: async (opts) => {
          disabledRulesets = opts;
        }
      }
    }
  };
  bgSandbox.self = bgSandbox;
  const bgCtx = vm.createContext(bgSandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "background.js"), "utf8"), bgCtx, { filename: "background.js" });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(updatedDynamic && updatedDynamic.addRules.length === 1, "DNR dynamic rule must be installed");
  const rule = updatedDynamic.addRules[0];
  assert.strictEqual(
    JSON.stringify(rule.condition.excludedRequestDomains),
    JSON.stringify(["disabled.example.com"]),
    "Per-site braveCloak=false must populate excludedRequestDomains"
  );
  assert.ok(rule.action.requestHeaders[0].value.includes('"Google Chrome";v="136"'));
  assert.ok(rule.action.requestHeaders[1].value.includes('"Google Chrome";v="136.0.0.0"'));
  assert.strictEqual(
    JSON.stringify(disabledRulesets),
    JSON.stringify({ disableRulesetIds: ["ruleset_client_hints"] })
  );
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
