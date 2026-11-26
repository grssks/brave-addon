"use strict";

(function () {
  const host = (location && location.hostname) || "";
  const path = (location && location.pathname) || "";
  const isCaptchaOrAuth =
    /(^|\.)(recaptcha\.net|hcaptcha\.com|challenges\.cloudflare\.com)$/i.test(host) ||
    (host === "www.google.com" && path.startsWith("/recaptcha/"));

  if (isCaptchaOrAuth) return;

  const state = {
    braveCloak: true,
    antiAdblock: true,
    unlockInteraction: true,
    keepAlive: true
  };

  const nativeStrings = new WeakMap();

  function maskFunction(fn, name, length) {
    try {
      Object.defineProperty(fn, "name", { value: name, configurable: true });
      Object.defineProperty(fn, "length", { value: length, configurable: true });
    } catch {
    }
    nativeStrings.set(fn, `function ${name}() { [native code] }`);
    return fn;
  }

  try {
    const origToString = Function.prototype.toString;
    if (typeof origToString === "function" && !nativeStrings.has(origToString)) {
      const proxiedToString = new Proxy(origToString, {
        apply(target, thisArg, args) {
          if (nativeStrings.has(thisArg)) {
            return nativeStrings.get(thisArg);
          }
          return Reflect.apply(target, thisArg, args);
        }
      });
      nativeStrings.set(proxiedToString, "function toString() { [native code] }");
      Object.defineProperty(Function.prototype, "toString", {
        value: proxiedToString,
        writable: true,
        enumerable: false,
        configurable: true
      });
    }
  } catch {
  }

  // Anti-adblock detector bypass

  const AD_BAIT_RE =
    /\b(ad|ads|advert|advertisement|ads?box|ad[-_]?(banner|slot|unit|test|bait|placement|container|wrapper|detector|sense|frame|space|zone|check|block)|ads[-_]?(banner|container|wrapper|slot|box)|pub_300x250|pub_728x90|text[-_]?ads?|textAd|sponsor[-_]?ads?|banner[-_]?ads?|google[-_]?ad|afs_ads|adsbygoogle|adblock)\b/i;

  const AD_PROBE_URL_RE =
    /(pagead2\.googlesyndication\.com|googlesyndication\.com\/pagead|doubleclick\.net|adservice\.google\.com|fundingchoicesmessages\.google\.com|amazon-adsystem\.com|static\.ads-twitter\.com|popads\.net|propellerads\.com|monetag\.com|admaven\.com|hilltopads\.net|exoclick\.com|highperformanceformat\.com|profitablegate|mgid\.com|taboola\.com|outbrain\.com|pubmatic\.com|adnxs\.com|criteo\.com|\/(ad|ads|adframe|showads|prebid|pop|fuckadblock|blockadblock|adsbygoogle)\.js(\?|$))/i;

  const LEGIT_SCRIPT_CDN_RE =
    /(^|\.)(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|ajax\.googleapis\.com|maps\.googleapis\.com|apis\.google\.com|accounts\.google\.com|www\.gstatic\.com|gstatic\.com|www\.youtube\.com|s\.ytimg\.com|code\.jquery\.com|stackpath\.bootstrapcdn\.com|maxcdn\.bootstrapcdn\.com|fonts\.googleapis\.com|esm\.sh|skypack\.dev|js\.stripe\.com|paypal\.com|cdn\.auth0\.com|browser\.sentry-cdn\.com|js\.sentry-cdn\.com|widget\.intercom\.io|js\.intercomcdn\.com|cdn\.shopify\.com|static\.cloudflareinsights\.com|recaptcha\.net|hcaptcha\.com|challenges\.cloudflare\.com)$/i;

  const AD_OVERLAY_SELECTORS =
    '.fc-ab-root, .fc-dialog-overlay, .unblocker-container, #adb-modal, [id*="adblock-notice"], [class*="adblock-modal"], [class*="anti-adblock"]';

  const AD_WALL_TEXT_RE =
    /(please\s+)?(turn\s+off|disable|pause|whitelist|deactivate|remove)\s+(your\s+)?(ad\s*-?\s*block(er|ing)?|ads?\s+blocker)|(ad\s*-?\s*block(er|ing)?)\s+(is\s+)?(detected|enabled|active|turned\s+on|blocking)|i\s+have\s+(turned\s+it\s+off|disabled\s+(my\s+)?ad\s*-?\s*block)|ads\s+keep\s+this\s+(site|link|page)\s+free/i;

  function isAdBait(el) {
    if (!state.antiAdblock || !el || el.nodeType !== 1) return false;
    const id = typeof el.id === "string" ? el.id : "";
    const cls = typeof el.className === "string" ? el.className : "";
    const isInsAd = el.tagName === "INS" && el.classList && el.classList.contains("adsbygoogle");
    const hasAdAttr =
      typeof el.hasAttribute === "function" &&
      (el.hasAttribute("data-ad") || el.hasAttribute("data-ad-slot") || el.hasAttribute("data-ad-client"));
    if (!isInsAd && !hasAdAttr && !AD_BAIT_RE.test(id) && !AD_BAIT_RE.test(cls)) {
      return false;
    }
    const text = (el.textContent || "").trim();
    return text.length < 24;
  }

  // Global ad-flag and library mocks
  const createdMocks = new Map();
  try {
    const adFlags = {
      canRunAds: true,
      isAdBlockActive: false,
      adBlockDetected: false,
      adblock: false,
      noAdblock: true
    };
    for (const [key, val] of Object.entries(adFlags)) {
      if (typeof window[key] === "undefined") {
        window[key] = val;
        createdMocks.set(key, val);
      }
    }

    if (typeof window.adsbygoogle === "undefined") {
      const adsbygoogleStub = [];
      adsbygoogleStub.loaded = true;
      adsbygoogleStub.push = () => 1;
      window.adsbygoogle = adsbygoogleStub;
      createdMocks.set("adsbygoogle", adsbygoogleStub);
    }

    const createBlockAdBlockStub = () => ({
      onDetected() {
        return this;
      },
      onNotDetected(fn) {
        if (typeof fn === "function") setTimeout(fn, 0);
        return this;
      },
      on(detected, fn) {
        if (!detected && typeof fn === "function") setTimeout(fn, 0);
        return this;
      },
      check() {
        return false;
      },
      setOption() {
        return this;
      },
      clearEvent() {
        return this;
      }
    });

    for (const libName of ["fuckAdBlock", "blockAdBlock", "sniffAdBlock"]) {
      if (typeof window[libName] === "undefined") {
        const stub = createBlockAdBlockStub();
        window[libName] = stub;
        createdMocks.set(libName, stub);
      }
    }
  } catch {
  }

  function cleanupGlobalMocks() {
    createdMocks.forEach((stub, key) => {
      try {
        if (window[key] === stub) {
          delete window[key];
        }
      } catch {
      }
    });
  }

  // Bait-element dimension and computed style spoofing
  try {
    if (typeof HTMLElement !== "undefined" && HTMLElement.prototype) {
      const dimPatches = [
        ["offsetHeight", 250],
        ["offsetWidth", 300],
        ["clientHeight", 250],
        ["clientWidth", 300]
      ];
      for (const [prop, fakeVal] of dimPatches) {
        const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
        if (desc && typeof desc.get === "function") {
          const origGet = desc.get;
          const patchedGet = maskFunction(
            function () {
              const val = origGet.call(this);
              if (val === 0 && isAdBait(this)) {
                return fakeVal;
              }
              return val;
            },
            `get ${prop}`,
            0
          );
          Object.defineProperty(HTMLElement.prototype, prop, {
            get: patchedGet,
            set: desc.set,
            enumerable: desc.enumerable,
            configurable: true
          });
        }
      }
      const opDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
      if (opDesc && typeof opDesc.get === "function") {
        const origOpGet = opDesc.get;
        Object.defineProperty(HTMLElement.prototype, "offsetParent", {
          get: maskFunction(
            function () {
              const val = origOpGet.call(this);
              if (val === null && this.isConnected && isAdBait(this)) {
                return document.body || document.documentElement;
              }
              return val;
            },
            "get offsetParent",
            0
          ),
          enumerable: opDesc.enumerable,
          configurable: true
        });
      }
    }
  } catch {
  }

  try {
    if (typeof Element !== "undefined" && Element.prototype && typeof Element.prototype.checkVisibility === "function") {
      const origCheckVis = Element.prototype.checkVisibility;
      Object.defineProperty(Element.prototype, "checkVisibility", {
        value: maskFunction(
          function checkVisibility() {
            const visible = origCheckVis.apply(this, arguments);
            if (!visible && this.isConnected && isAdBait(this)) {
              return true;
            }
            return visible;
          },
          "checkVisibility",
          0
        ),
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
  } catch {
  }

  try {
    if (typeof Element !== "undefined" && Element.prototype && typeof Element.prototype.getBoundingClientRect === "function") {
      const origRect = Element.prototype.getBoundingClientRect;
      const patchedRect = maskFunction(
        function getBoundingClientRect() {
          const rect = origRect.call(this);
          if (rect && rect.height === 0 && rect.width === 0 && isAdBait(this)) {
            return {
              width: 300,
              height: 250,
              top: 0,
              left: 0,
              right: 300,
              bottom: 250,
              x: 0,
              y: 0,
              toJSON() {
                return this;
              }
            };
          }
          return rect;
        },
        "getBoundingClientRect",
        0
      );
      Object.defineProperty(Element.prototype, "getBoundingClientRect", {
        value: patchedRect,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
  } catch {
  }

  const origGetComputedStyle = typeof window.getComputedStyle === "function" ? window.getComputedStyle.bind(window) : null;
  try {
    if (origGetComputedStyle) {
      const patchedGetComputedStyle = maskFunction(
        function getComputedStyle(el, pseudoElt) {
          const style = origGetComputedStyle(el, pseudoElt);
          if (!style || !isAdBait(el)) return style;
          if (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.visibility !== "collapse" &&
            style.opacity !== "0" &&
            style.height !== "0px"
          ) {
            return style;
          }
          return new Proxy(style, {
            get(target, prop) {
              if (prop === "display") return "block";
              if (prop === "visibility") return "visible";
              if (prop === "opacity") return "1";
              if (prop === "width") return "300px";
              if (prop === "height") return "250px";
              if (prop === "getPropertyValue") {
                return (name) => {
                  if (name === "display") return "block";
                  if (name === "visibility") return "visible";
                  if (name === "opacity") return "1";
                  if (name === "width") return "300px";
                  if (name === "height") return "250px";
                  return target.getPropertyValue(name);
                };
              }
              const value = Reflect.get(target, prop);
              return typeof value === "function" ? value.bind(target) : value;
            }
          });
        },
        "getComputedStyle",
        2
      );
      Object.defineProperty(window, "getComputedStyle", {
        value: patchedGetComputedStyle,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
  } catch {
  }

  // Network probe spoofing (fetch, script/img onerror, XHR)
  function getBaseDomain(hostname) {
    const parts = String(hostname || "").toLowerCase().split(".").filter(Boolean);
    return parts.length >= 2 ? parts.slice(-2).join(".") : parts.join(".");
  }

  function isThirdPartyHost(hostname) {
    if (!hostname || !host) return false;
    return getBaseDomain(hostname) !== getBaseDomain(host);
  }

  try {
    if (typeof window.fetch === "function") {
      const origFetch = window.fetch;
      const patchedFetch = maskFunction(
        function fetch(input, init) {
          const url = typeof input === "string" ? input : input && typeof input.url === "string" ? input.url : "";
          const p = origFetch.apply(this, arguments);
          if (!state.antiAdblock || !url) {
            return p;
          }
          let isBehavioralProbe = false;
          if (!AD_PROBE_URL_RE.test(url)) {
            const isNoCors =
              (init && init.mode === "no-cors") ||
              (input && typeof input === "object" && input.mode === "no-cors");
            if (isNoCors) {
              try {
                const parsed = new URL(url, location.href);
                if (isThirdPartyHost(parsed.hostname)) {
                  isBehavioralProbe = true;
                }
              } catch {}
            }
            if (!isBehavioralProbe) return p;
          }
          return p.catch(() => {
            if (typeof Response === "function") {
              return new Response("/* ok */", {
                status: 200,
                statusText: "OK",
                headers: { "Content-Type": "application/javascript" }
              });
            }
            return { ok: true, status: 200, text: async () => "/* ok */" };
          });
        },
        "fetch",
        1
      );
      Object.defineProperty(window, "fetch", {
        value: patchedFetch,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
  } catch {
  }

  function isHiddenCrossOriginImgProbe(target) {
    if (!target || target.tagName !== "IMG" || typeof target.src !== "string" || !target.src) return false;
    try {
      const parsed = new URL(target.src, location.href);
      if (!isThirdPartyHost(parsed.hostname)) return false;
    } catch {
      return false;
    }
    const w = Number(target.width);
    const h = Number(target.height);
    if (Number.isFinite(w) && Number.isFinite(h) && w <= 1 && h <= 1) return true;
    if (target.style && (target.style.display === "none" || target.style.visibility === "hidden")) return true;
    return false;
  }

  function isCrossOriginNonCdnScript(target) {
    if (!target || target.tagName !== "SCRIPT" || typeof target.src !== "string" || !target.src) return false;
    try {
      const parsed = new URL(target.src, location.href);
      if (!isThirdPartyHost(parsed.hostname)) return false;
      return !LEGIT_SCRIPT_CDN_RE.test(parsed.hostname);
    } catch {
      return false;
    }
  }

  try {
    window.addEventListener(
      "error",
      (e) => {
        if (!state.antiAdblock || !e || !e.target) return;
        const target = e.target;
        const isUrlMatch =
          (target.tagName === "SCRIPT" || target.tagName === "IMG") &&
          typeof target.src === "string" &&
          AD_PROBE_URL_RE.test(target.src);
        if (isUrlMatch || isHiddenCrossOriginImgProbe(target) || isCrossOriginNonCdnScript(target)) {
          e.stopImmediatePropagation();
          try {
            target.onerror = null;
          } catch {
          }
          try {
            target.dispatchEvent(new Event("load"));
          } catch {
          }
        }
      },
      true
    );
  } catch {
  }

  try {
    if (typeof XMLHttpRequest !== "undefined" && XMLHttpRequest.prototype) {
      const xhrUrls = new WeakMap();
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;

      if (typeof origOpen === "function") {
        XMLHttpRequest.prototype.open = maskFunction(
          function open(method, url) {
            try {
              xhrUrls.set(this, typeof url === "string" ? url : String(url || ""));
            } catch {}
            return origOpen.apply(this, arguments);
          },
          "open",
          2
        );
      }

      if (typeof origSend === "function") {
        XMLHttpRequest.prototype.send = maskFunction(
          function send() {
            const url = xhrUrls.get(this) || "";
            if (state.antiAdblock && url && AD_PROBE_URL_RE.test(url)) {
              const xhr = this;
              const onErr = (e) => {
                xhr.removeEventListener("error", onErr, true);
                if (!state.antiAdblock) return;
                if (e && typeof e.stopImmediatePropagation === "function") {
                  e.stopImmediatePropagation();
                }
                try {
                  Object.defineProperties(xhr, {
                    status: { value: 200, configurable: true },
                    statusText: { value: "OK", configurable: true },
                    responseText: { value: "/* ok */", configurable: true },
                    response: { value: "/* ok */", configurable: true }
                  });
                } catch {}
                try {
                  xhr.dispatchEvent(new Event("load"));
                  xhr.dispatchEvent(new Event("loadend"));
                } catch {}
              };
              xhr.addEventListener("error", onErr, true);
            }
            return origSend.apply(this, arguments);
          },
          "send",
          1
        );
      }
    }
  } catch {
  }

  // Anti-adblock overlay and scroll-lock cleanup
  function isFixedOrDialogOverlay(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      const role = typeof el.getAttribute === "function" ? el.getAttribute("role") : "";
      const ariaModal = typeof el.getAttribute === "function" ? el.getAttribute("aria-modal") : "";
      if (role === "dialog" || ariaModal === "true") return true;
      if (el.style && el.style.position === "fixed") return true;
      if (origGetComputedStyle) {
        const cs = origGetComputedStyle(el);
        if (cs) {
          if (cs.position === "fixed") return true;
          if (cs.position === "sticky" && parseInt(cs.zIndex, 10) >= 99) return true;
        }
      }
    } catch {}
    return false;
  }

  function findAdblockWallRoot(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.tagName;
    if (tag === "HTML" || tag === "BODY" || tag === "HEAD" || tag === "SCRIPT" || tag === "STYLE" || tag === "MAIN" || tag === "ARTICLE") {
      return null;
    }
    let text = "";
    try {
      text = (el.shadowRoot ? el.shadowRoot.textContent : el.textContent) || "";
    } catch {
      text = el.textContent || "";
    }
    text = text.trim();
    if (text.length < 15 || text.length > 1200 || !AD_WALL_TEXT_RE.test(text)) {
      return null;
    }
    if (!isFixedOrDialogOverlay(el)) {
      return null;
    }
    let root = el;
    let parent = root.parentElement;
    let depth = 0;
    while (parent && parent !== document.body && parent !== document.documentElement && depth < 3) {
      if (isFixedOrDialogOverlay(parent)) {
        root = parent;
        parent = root.parentElement;
        depth++;
      } else {
        break;
      }
    }
    return root;
  }

  function unlockBodyScrollAndBlur() {
    for (const el of [document.documentElement, document.body]) {
      if (!el || !el.style) continue;
      if (el.style.overflow === "hidden" || el.style.overflow === "clip") el.style.overflow = "";
      if (el.style.overflowY === "hidden" || el.style.overflowY === "clip") el.style.overflowY = "";
      if (el.style.pointerEvents === "none") el.style.pointerEvents = "";
      if (typeof el.style.filter === "string" && el.style.filter.includes("blur")) el.style.filter = "";
    }
  }

  function cleanAdblockOverlays(roots) {
    if (!state.antiAdblock || !document.documentElement) return;
    let removedAny = false;
    try {
      const targets = new Set();
      if (Array.isArray(roots)) {
        for (let i = 0; i < roots.length; i++) {
          const root = roots[i];
          if (!root || root.nodeType !== 1 || !root.isConnected) continue;
          if (typeof root.matches === "function" && root.matches(AD_OVERLAY_SELECTORS)) {
            targets.add(root);
          }
          if (typeof root.querySelectorAll === "function") {
            const inner = root.querySelectorAll(AD_OVERLAY_SELECTORS);
            for (let j = 0; j < inner.length; j++) {
              targets.add(inner[j]);
            }
          }
          const wall = findAdblockWallRoot(root);
          if (wall) targets.add(wall);
          if (root.children) {
            for (let j = 0; j < root.children.length; j++) {
              const childWall = findAdblockWallRoot(root.children[j]);
              if (childWall) targets.add(childWall);
            }
          }
        }
      } else {
        const nodes = document.querySelectorAll(AD_OVERLAY_SELECTORS);
        for (let i = 0; i < nodes.length; i++) {
          targets.add(nodes[i]);
        }
        const containers = [document.body, document.documentElement];
        for (let c = 0; c < containers.length; c++) {
          const cont = containers[c];
          if (!cont || !cont.children) continue;
          for (let i = 0; i < cont.children.length; i++) {
            const wall = findAdblockWallRoot(cont.children[i]);
            if (wall) targets.add(wall);
          }
        }
        const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
        for (let i = 0; i < dialogs.length; i++) {
          const wall = findAdblockWallRoot(dialogs[i]);
          if (wall) targets.add(wall);
        }
      }
      targets.forEach((node) => {
        node.remove();
        removedAny = true;
      });
      if (removedAny) {
        unlockBodyScrollAndBlur();
      }
    } catch {
    }
  }

  const pendingOverlayRoots = new Set();
  let overlayCleanTimer = null;
  function scheduleOverlayClean(addedNodes) {
    if (!state.antiAdblock) return;
    for (let i = 0; i < addedNodes.length && pendingOverlayRoots.size < 200; i++) {
      if (addedNodes[i] && addedNodes[i].nodeType === 1) {
        pendingOverlayRoots.add(addedNodes[i]);
      }
    }
    if (pendingOverlayRoots.size === 0 || overlayCleanTimer !== null) return;
    overlayCleanTimer = nativeSetTimeout(() => {
      overlayCleanTimer = null;
      const batch = Array.from(pendingOverlayRoots);
      pendingOverlayRoots.clear();
      cleanAdblockOverlays(batch);
    }, 300);
  }

  // Copy, right-click, selection, and drag unlock

  const UNLOCK_STYLE_ID = "__brave_addon_unlock_css__";
  const UNLOCK_CSS = [
    "*, *::before, *::after {",
    "  -webkit-user-select: text !important;",
    "  user-select: text !important;",
    "}",
    'button, input[type="button"], input[type="submit"], input[type="reset"], select, canvas, svg, [role="slider"], [role="button"], [role="tab"], [role="switch"], [role="application"], [role="grid"], [role="treegrid"], [role="listbox"], [role="menu"], [role="menubar"], [draggable="true"] {',
    "  -webkit-user-select: none !important;",
    "  user-select: none !important;",
    "}",
    "img {",
    "  -webkit-user-drag: auto !important;",
    "}"
  ].join("\n");

  function syncUnlockStyles() {
    try {
      const existing = document.getElementById(UNLOCK_STYLE_ID);
      if (!state.unlockInteraction) {
        if (existing) existing.remove();
        return;
      }
      if (existing) return;
      const parent = document.head || document.documentElement;
      if (!parent) return;
      const style = document.createElement("style");
      style.id = UNLOCK_STYLE_ID;
      style.textContent = UNLOCK_CSS;
      parent.appendChild(style);
    } catch {
    }
  }

  function clearDom0Handlers(target) {
    try {
      if (typeof window.oncontextmenu === "function") window.oncontextmenu = null;
      for (const prop of ["oncontextmenu", "onselectstart", "oncopy", "oncut"]) {
        if (typeof document[prop] === "function") document[prop] = null;
        if (document.body && typeof document.body[prop] === "function") document.body[prop] = null;
      }
      let cur = target;
      let depth = 0;
      while (cur && cur.nodeType === 1 && depth < 5) {
        if (cur.hasAttribute && cur.hasAttribute("oncontextmenu")) cur.removeAttribute("oncontextmenu");
        if (cur.hasAttribute && cur.hasAttribute("onselectstart")) cur.removeAttribute("onselectstart");
        cur = cur.parentElement;
        depth++;
      }
    } catch {
    }
  }

  function hasAncestorMatch(el, pred, maxDepth = 4) {
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth <= maxDepth) {
      if (pred(cur)) return true;
      cur = cur.parentElement;
      depth++;
    }
    return false;
  }

  for (const evtName of ["contextmenu", "selectstart", "copy", "cut", "dragstart"]) {
    window.addEventListener(
      evtName,
      (e) => {
        if (!state.unlockInteraction) return;
        if (evtName === "dragstart") {
          if (hasAncestorMatch(e.target, (n) => n.isContentEditable || (n.getAttribute && n.getAttribute("draggable") === "true"))) {
            return;
          }
        } else if (evtName === "contextmenu") {
          if (hasAncestorMatch(e.target, (n) => n.tagName === "CANVAS" || (n.getAttribute && /^(application|grid|treegrid)$/.test(n.getAttribute("role") || "")))) {
            return;
          }
        }
        e.stopImmediatePropagation();
        if (evtName !== "dragstart") {
          clearDom0Handlers(e.target);
        }
      },
      true
    );
  }

  window.addEventListener(
    "paste",
    (e) => {
      if (!state.unlockInteraction || !e.target) return;
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        e.stopImmediatePropagation();
      }
    },
    true
  );

  window.addEventListener(
    "keydown",
    (e) => {
      if (!state.unlockInteraction || !(e.ctrlKey || e.metaKey)) return;
      const key = e.key || "";
      const target = e.target;
      if (/^[cax]$/i.test(key)) {
        if (target && target.isContentEditable) return;
        e.stopImmediatePropagation();
      } else if (/^v$/i.test(key)) {
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
          e.stopImmediatePropagation();
        }
      }
    },
    true
  );

  // Background tab keep-alive and visibility spoofing

  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  const nativeRAF = typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame.bind(window) : null;
  const nativeCAF = typeof window.cancelAnimationFrame === "function" ? window.cancelAnimationFrame.bind(window) : null;

  const hiddenDesc = typeof Document !== "undefined" ? Object.getOwnPropertyDescriptor(Document.prototype, "hidden") : null;
  const webkitHiddenDesc = typeof Document !== "undefined" ? Object.getOwnPropertyDescriptor(Document.prototype, "webkitHidden") : null;
  const visDesc = typeof Document !== "undefined" ? Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState") : null;
  const webkitVisDesc = typeof Document !== "undefined" ? Object.getOwnPropertyDescriptor(Document.prototype, "webkitVisibilityState") : null;
  const nativeHasFocus = typeof Document !== "undefined" && typeof Document.prototype.hasFocus === "function" ? Document.prototype.hasFocus : null;

  const nativeHiddenGet = hiddenDesc && typeof hiddenDesc.get === "function" ? hiddenDesc.get : null;

  function getRealHidden() {
    try {
      return nativeHiddenGet ? Boolean(nativeHiddenGet.call(document)) : false;
    } catch {
      return false;
    }
  }

  let realHidden = getRealHidden();
  let nextTimerId = 1000000;
  let nextRafId = 1000000;
  const timers = new Map();
  const rafQueue = new Map();

  let usingBackgroundTick = false;
  let lastRafAt = 0;

  function invokeCallback(fn, args) {
    try {
      if (typeof fn === "function") {
        fn.apply(window, args);
      } else if (typeof fn === "string") {
        // Indirect eval for legacy string timer callbacks.
        (0, eval)(fn);
      }
    } catch (err) {
      nativeSetTimeout(() => {
        throw err;
      }, 0);
    }
  }

  function processBackgroundTick() {
    if (!realHidden || !state.keepAlive) return;
    const now = performance.now();

    const dueIds = [];
    timers.forEach((entry, id) => {
      if (entry.dueAt <= now) {
        dueIds.push(id);
      }
    });

    for (let i = 0; i < dueIds.length; i++) {
      const id = dueIds[i];
      const entry = timers.get(id);
      if (!entry) continue;
      if (!entry.isInterval) {
        timers.delete(id);
      } else {
        entry.dueAt = now + Math.max(entry.delay, 10);
      }
      invokeCallback(entry.fn, entry.args);
    }

    if (rafQueue.size > 0 && now - lastRafAt >= 100) {
      lastRafAt = now;
      const callbacks = Array.from(rafQueue.values());
      rafQueue.clear();
      for (let i = 0; i < callbacks.length; i++) {
        invokeCallback(callbacks[i], [now]);
      }
    }

    if (timers.size === 0 && rafQueue.size === 0) {
      stopBackgroundTicker();
    }
  }

  function startBackgroundTicker() {
    if (usingBackgroundTick) return;
    usingBackgroundTick = true;
    try {
      document.dispatchEvent(new CustomEvent("__brave_addon_tick_ctrl__", { detail: { active: true } }));
    } catch {
    }
  }

  function stopBackgroundTicker() {
    if (!usingBackgroundTick) return;
    usingBackgroundTick = false;
    try {
      document.dispatchEvent(new CustomEvent("__brave_addon_tick_ctrl__", { detail: { active: false } }));
    } catch {
    }
  }

  document.addEventListener("__brave_addon_tick__", processBackgroundTick);

  function armNativeTimer(id, entry) {
    if (entry.nativeId !== null) return;
    const now = performance.now();
    const remaining = Math.max(0, entry.dueAt - now);
    if (!entry.isInterval) {
      entry.nativeId = nativeSetTimeout(() => {
        if (!timers.has(id)) return;
        timers.delete(id);
        invokeCallback(entry.fn, entry.args);
      }, remaining);
    } else {
      entry.nativeId = nativeSetInterval(() => {
        const cur = timers.get(id);
        if (!cur) return;
        cur.dueAt = performance.now() + cur.delay;
        invokeCallback(cur.fn, cur.args);
      }, entry.delay);
    }
  }

  function disarmNativeTimer(entry) {
    if (entry.nativeId === null) return;
    if (entry.isInterval) {
      nativeClearInterval(entry.nativeId);
    } else {
      nativeClearTimeout(entry.nativeId);
    }
    entry.nativeId = null;
  }

  function syncBackgroundMode() {
    const shouldProxy = realHidden && state.keepAlive;
    if (shouldProxy) {
      timers.forEach((entry) => disarmNativeTimer(entry));
      if (timers.size > 0 || rafQueue.size > 0) {
        startBackgroundTicker();
      } else {
        stopBackgroundTicker();
      }
    } else {
      stopBackgroundTicker();
      timers.forEach((entry, id) => armNativeTimer(id, entry));
      if (rafQueue.size > 0 && nativeRAF) {
        const pending = Array.from(rafQueue.entries());
        rafQueue.clear();
        for (let i = 0; i < pending.length; i++) {
          const [, cb] = pending[i];
          nativeRAF(cb);
        }
      }
    }
  }

  // Register real visibility tracker before installing the visibilitychange suppressor.
  for (const visEvt of ["visibilitychange", "webkitvisibilitychange"]) {
    document.addEventListener(
      visEvt,
      (e) => {
        realHidden = getRealHidden();
        syncBackgroundMode();
        if (state.keepAlive) {
          e.stopImmediatePropagation();
        }
      },
      true
    );
  }

  try {
    if (nativeHiddenGet) {
      Object.defineProperty(Document.prototype, "hidden", {
        get: maskFunction(
          function () {
            return state.keepAlive ? false : nativeHiddenGet.call(this);
          },
          "get hidden",
          0
        ),
        enumerable: hiddenDesc.enumerable,
        configurable: true
      });
    }
    if (webkitHiddenDesc && typeof webkitHiddenDesc.get === "function") {
      const origWebkitHidden = webkitHiddenDesc.get;
      Object.defineProperty(Document.prototype, "webkitHidden", {
        get: maskFunction(
          function () {
            return state.keepAlive ? false : origWebkitHidden.call(this);
          },
          "get webkitHidden",
          0
        ),
        enumerable: webkitHiddenDesc.enumerable,
        configurable: true
      });
    }
    if (visDesc && typeof visDesc.get === "function") {
      const origVis = visDesc.get;
      Object.defineProperty(Document.prototype, "visibilityState", {
        get: maskFunction(
          function () {
            return state.keepAlive ? "visible" : origVis.call(this);
          },
          "get visibilityState",
          0
        ),
        enumerable: visDesc.enumerable,
        configurable: true
      });
    }
    if (webkitVisDesc && typeof webkitVisDesc.get === "function") {
      const origWebkitVis = webkitVisDesc.get;
      Object.defineProperty(Document.prototype, "webkitVisibilityState", {
        get: maskFunction(
          function () {
            return state.keepAlive ? "visible" : origWebkitVis.call(this);
          },
          "get webkitVisibilityState",
          0
        ),
        enumerable: webkitVisDesc.enumerable,
        configurable: true
      });
    }
    if (nativeHasFocus) {
      Object.defineProperty(Document.prototype, "hasFocus", {
        value: maskFunction(
          function hasFocus() {
            return state.keepAlive ? true : nativeHasFocus.call(this);
          },
          "hasFocus",
          0
        ),
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
  } catch {
  }

  // Suppress page-level blur and mouseleave without breaking input blur.
  for (const winEvt of ["visibilitychange", "webkitvisibilitychange", "pagehide", "freeze"]) {
    window.addEventListener(
      winEvt,
      (e) => {
        if (state.keepAlive) e.stopImmediatePropagation();
      },
      true
    );
  }

  for (const docEvt of ["pagehide", "freeze"]) {
    document.addEventListener(
      docEvt,
      (e) => {
        if (state.keepAlive) e.stopImmediatePropagation();
      },
      true
    );
  }

  window.addEventListener(
    "blur",
    (e) => {
      if (state.keepAlive && (e.target === window || e.target === document)) {
        e.stopImmediatePropagation();
      }
    },
    true
  );

  document.addEventListener(
    "mouseleave",
    (e) => {
      if (state.keepAlive && (e.target === document || e.target === document.documentElement)) {
        e.stopImmediatePropagation();
      }
    },
    true
  );

  // Guard DOM0 visibility/blur handlers
  function findPropDescriptor(obj, prop) {
    let cur = obj;
    while (cur) {
      const desc = Object.getOwnPropertyDescriptor(cur, prop);
      if (desc) return desc;
      cur = Object.getPrototypeOf(cur);
    }
    return null;
  }

  function guardEventProp(obj, prop) {
    try {
      const desc = findPropDescriptor(obj, prop);
      let stored = null;
      Object.defineProperty(obj, prop, {
        get() {
          return desc && desc.get ? desc.get.call(this) : stored;
        },
        set(fn) {
          stored = fn;
          if (!state.keepAlive && desc && desc.set) {
            desc.set.call(this, fn);
          }
        },
        configurable: true
      });
    } catch {
    }
  }

  guardEventProp(window, "onblur");
  guardEventProp(window, "onpagehide");
  guardEventProp(window, "onfreeze");
  guardEventProp(document, "onvisibilitychange");
  guardEventProp(document, "onwebkitvisibilitychange");

  try {
    window.setTimeout = maskFunction(
      function setTimeout(fn, delay, ...args) {
        const d = Math.min(2147483647, Math.max(0, Number(delay) || 0));
        if (!realHidden && d < 500) {
          return nativeSetTimeout(fn, d, ...args);
        }
        const id = nextTimerId++;
        const entry = {
          fn,
          args,
          delay: d,
          isInterval: false,
          dueAt: performance.now() + d,
          nativeId: null
        };
        timers.set(id, entry);
        if (!realHidden || !state.keepAlive) {
          armNativeTimer(id, entry);
        } else {
          startBackgroundTicker();
        }
        return id;
      },
      "setTimeout",
      2
    );

    window.clearTimeout = maskFunction(
      function clearTimeout(id) {
        const numId = Number(id);
        const entry = timers.get(numId);
        if (!entry) {
          nativeClearTimeout(numId);
          return;
        }
        disarmNativeTimer(entry);
        timers.delete(numId);
        if (realHidden && state.keepAlive && timers.size === 0 && rafQueue.size === 0) {
          stopBackgroundTicker();
        }
      },
      "clearTimeout",
      1
    );

    window.setInterval = maskFunction(
      function setInterval(fn, delay, ...args) {
        const id = nextTimerId++;
        const d = Math.min(2147483647, Math.max(10, Number(delay) || 0));
        const entry = {
          fn,
          args,
          delay: d,
          isInterval: true,
          dueAt: performance.now() + d,
          nativeId: null
        };
        timers.set(id, entry);
        if (!realHidden || !state.keepAlive) {
          armNativeTimer(id, entry);
        } else {
          startBackgroundTicker();
        }
        return id;
      },
      "setInterval",
      2
    );

    window.clearInterval = maskFunction(
      function clearInterval(id) {
        const numId = Number(id);
        const entry = timers.get(numId);
        if (!entry) {
          nativeClearInterval(numId);
          return;
        }
        disarmNativeTimer(entry);
        timers.delete(numId);
        if (realHidden && state.keepAlive && timers.size === 0 && rafQueue.size === 0) {
          stopBackgroundTicker();
        }
      },
      "clearInterval",
      1
    );

    if (nativeRAF && nativeCAF) {
      const nativeRafIds = new Map();

      window.requestAnimationFrame = maskFunction(
        function requestAnimationFrame(cb) {
          const id = nextRafId++;
          if (!realHidden || !state.keepAlive) {
            const nid = nativeRAF((ts) => {
              nativeRafIds.delete(id);
              invokeCallback(cb, [ts]);
            });
            nativeRafIds.set(id, nid);
          } else {
            rafQueue.set(id, cb);
            startBackgroundTicker();
          }
          return id;
        },
        "requestAnimationFrame",
        1
      );

      window.cancelAnimationFrame = maskFunction(
        function cancelAnimationFrame(id) {
          const numId = Number(id);
          if (nativeRafIds.has(numId)) {
            nativeCAF(nativeRafIds.get(numId));
            nativeRafIds.delete(numId);
          }
          rafQueue.delete(numId);
          if (realHidden && state.keepAlive && timers.size === 0 && rafQueue.size === 0) {
            stopBackgroundTicker();
          }
        },
        "cancelAnimationFrame",
        1
      );
    }
  } catch {
  }

  // Brave cloak (JS, iframes, and Dedicated Workers)

  const cloakedWindows = new WeakSet();
  const savedBraveDescs = new WeakMap();

  function getChromeVersions(win) {
    const ua = (win && win.navigator && win.navigator.userAgent) || "";
    const match = ua.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/);
    const full = match ? match[1] : "136.0.0.0";
    const major = full.split(".")[0] || "136";
    return { major, full };
  }

  function normalizeBrandList(list, isFullVersion, win) {
    if (!Array.isArray(list)) return list;
    const { major, full } = getChromeVersions(win);
    const fallbackVersion = isFullVersion ? full : major;
    const seen = new Set();
    const normalized = [];

    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const rawBrand = typeof item.brand === "string" ? item.brand : "";
      const brand = /brave/i.test(rawBrand) ? "Google Chrome" : rawBrand;
      const key = brand.toLowerCase();
      if (!brand || seen.has(key)) continue;
      seen.add(key);
      normalized.push({ brand, version: item.version });
    }

    if (!seen.has("google chrome")) {
      const chromiumEntry = normalized.find((item) => item.brand.toLowerCase() === "chromium");
      const chromeVersion = chromiumEntry && chromiumEntry.version ? chromiumEntry.version : fallbackVersion;
      const chromiumIdx = normalized.findIndex((item) => item.brand.toLowerCase() === "chromium");
      const insertAt = chromiumIdx >= 0 ? chromiumIdx + 1 : 0;
      normalized.splice(insertAt, 0, { brand: "Google Chrome", version: chromeVersion });
    }

    return normalized;
  }

  function buildWorkerBootstrap(absUrl, isModule, major, full) {
    const patchCode = `
(function(){
  var major=${JSON.stringify(major)},full=${JSON.stringify(full)};
  function norm(list,isFull){
    if(!Array.isArray(list))return list;
    var fb=isFull?full:major,seen=new Set(),out=[];
    for(var i=0;i<list.length;i++){
      var it=list[i];if(!it||typeof it!=="object")continue;
      var rb=typeof it.brand==="string"?it.brand:"";
      var b=/brave/i.test(rb)?"Google Chrome":rb,k=b.toLowerCase();
      if(!b||seen.has(k))continue;seen.add(k);out.push({brand:b,version:it.version});
    }
    if(!seen.has("google chrome")){
      var ci=out.findIndex(function(x){return x.brand.toLowerCase()==="chromium";});
      var v=(ci>=0&&out[ci].version)?out[ci].version:fb;
      out.splice(ci>=0?ci+1:0,0,{brand:"Google Chrome",version:v});
    }
    return out;
  }
  try{if(self.WorkerNavigator&&self.WorkerNavigator.prototype)delete self.WorkerNavigator.prototype.brave;}catch(e){}
  try{if(self.navigator&&"brave" in self.navigator)delete self.navigator.brave;}catch(e){}
  try{
    var P=self.NavigatorUAData&&self.NavigatorUAData.prototype;
    if(P){
      var bd=Object.getOwnPropertyDescriptor(P,"brands");
      if(bd&&typeof bd.get==="function"){
        var ob=bd.get;
        Object.defineProperty(P,"brands",{get:function(){return norm(ob.call(this),false);},enumerable:true,configurable:true});
      }
      if(typeof P.toJSON==="function"){
        var ot=P.toJSON;
        P.toJSON=function(){var r=ot.call(this);return r&&typeof r==="object"?Object.assign({},r,{brands:norm(r.brands,false)}):r;};
      }
      if(typeof P.getHighEntropyValues==="function"){
        var og=P.getHighEntropyValues;
        P.getHighEntropyValues=function(){
          return og.apply(this,arguments).then(function(res){
            if(!res||typeof res!=="object")return res;
            var out=Object.assign({},res);
            if(Array.isArray(out.brands))out.brands=norm(out.brands,false);
            if(Array.isArray(out.fullVersionList))out.fullVersionList=norm(out.fullVersionList,true);
            return out;
          });
        };
      }
    }
  }catch(e){}
  var baseUrl=${JSON.stringify(absUrl)};
  function resUrl(u){try{return typeof u==="string"?new URL(u,baseUrl).href:u;}catch(e){return u;}}
  try{if(typeof self.importScripts==="function"){var oi=self.importScripts;self.importScripts=function(){var a=[];for(var i=0;i<arguments.length;i++)a.push(resUrl(arguments[i]));return oi.apply(self,a);};}}catch(e){}
  try{if(typeof self.fetch==="function"){var of=self.fetch;self.fetch=function(r,init){if(typeof r==="string"){var a=[resUrl(r)];for(var i=1;i<arguments.length;i++)a.push(arguments[i]);return of.apply(self,a);}return of.apply(self,arguments);};}}catch(e){}
  try{if(self.XMLHttpRequest&&self.XMLHttpRequest.prototype&&typeof self.XMLHttpRequest.prototype.open==="function"){var xo=self.XMLHttpRequest.prototype.open;self.XMLHttpRequest.prototype.open=function(m,u){var a=[m,resUrl(u)];for(var i=2;i<arguments.length;i++)a.push(arguments[i]);return xo.apply(this,a);};}}catch(e){}
})();
`;
    const loader = isModule
      ? `import ${JSON.stringify(absUrl)};`
      : `importScripts(${JSON.stringify(absUrl)});`;
    return patchCode + "\n" + loader;
  }

  function cloakWindow(win) {
    if (!state.braveCloak || !win || typeof win !== "object") return;
    try {
      if (cloakedWindows.has(win)) return;
      cloakedWindows.add(win);
    } catch {
      return;
    }

    try {
      const origToString = win.Function && win.Function.prototype.toString;
      if (typeof origToString === "function" && !nativeStrings.has(origToString)) {
        const proxiedToString = new Proxy(origToString, {
          apply(target, thisArg, args) {
            if (nativeStrings.has(thisArg)) {
              return nativeStrings.get(thisArg);
            }
            return Reflect.apply(target, thisArg, args);
          }
        });
        nativeStrings.set(proxiedToString, "function toString() { [native code] }");
        Object.defineProperty(win.Function.prototype, "toString", {
          value: proxiedToString,
          writable: true,
          enumerable: false,
          configurable: true
        });
      }
    } catch {}

    try {
      if (!savedBraveDescs.has(win)) {
        savedBraveDescs.set(win, {
          protoDesc:
            win.Navigator && win.Navigator.prototype
              ? Object.getOwnPropertyDescriptor(win.Navigator.prototype, "brave") || null
              : null,
          ownDesc: win.navigator ? Object.getOwnPropertyDescriptor(win.navigator, "brave") || null : null
        });
      }
    } catch {}

    try {
      if (win.Navigator && win.Navigator.prototype) {
        delete win.Navigator.prototype.brave;
      }
    } catch {}

    try {
      if (win.navigator && "brave" in win.navigator) {
        delete win.navigator.brave;
      }
    } catch {}

    try {
      if (win.navigator && "brave" in win.navigator && win.Navigator && win.Navigator.prototype) {
        Object.defineProperty(win.Navigator.prototype, "brave", {
          value: undefined,
          configurable: true
        });
      }
    } catch {}

    try {
      const UADataProto = win.NavigatorUAData && win.NavigatorUAData.prototype;
      if (UADataProto) {
        const brandsDesc = Object.getOwnPropertyDescriptor(UADataProto, "brands");
        if (brandsDesc && typeof brandsDesc.get === "function") {
          const origBrandsGetter = brandsDesc.get;
          const getBrands = maskFunction(
            function () {
              const raw = origBrandsGetter.call(this);
              return state.braveCloak ? normalizeBrandList(raw, false, win) : raw;
            },
            "get brands",
            0
          );
          Object.defineProperty(UADataProto, "brands", {
            get: getBrands,
            set: undefined,
            enumerable: true,
            configurable: true
          });
        }

        if (typeof UADataProto.toJSON === "function") {
          const origToJSON = UADataProto.toJSON;
          const patchedToJSON = maskFunction(
            function toJSON() {
              const raw = origToJSON.call(this);
              if (state.braveCloak && raw && typeof raw === "object") {
                return {
                  ...raw,
                  brands: normalizeBrandList(raw.brands, false, win)
                };
              }
              return raw;
            },
            "toJSON",
            0
          );
          Object.defineProperty(UADataProto, "toJSON", {
            value: patchedToJSON,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }

        if (typeof UADataProto.getHighEntropyValues === "function") {
          const origGetHighEntropy = UADataProto.getHighEntropyValues;
          const patchedGetHighEntropy = maskFunction(
            function getHighEntropyValues() {
              return origGetHighEntropy.apply(this, arguments).then((results) => {
                if (state.braveCloak && results && typeof results === "object") {
                  const out = { ...results };
                  if (Array.isArray(out.brands)) {
                    out.brands = normalizeBrandList(out.brands, false, win);
                  }
                  if (Array.isArray(out.fullVersionList)) {
                    out.fullVersionList = normalizeBrandList(out.fullVersionList, true, win);
                  }
                  return out;
                }
                return results;
              });
            },
            "getHighEntropyValues",
            1
          );
          Object.defineProperty(UADataProto, "getHighEntropyValues", {
            value: patchedGetHighEntropy,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
    } catch {}

    try {
      const OrigWorker = win.Worker;
      if (typeof OrigWorker === "function" && typeof win.Blob === "function" && win.URL && typeof win.URL.createObjectURL === "function") {
        let workerBlobBlocked = false;
        try {
          if (win.document && typeof win.document.addEventListener === "function") {
            win.document.addEventListener(
              "securitypolicyviolation",
              (e) => {
                if (e && e.effectiveDirective === "worker-src" && String(e.blockedURI || "").startsWith("blob")) {
                  workerBlobBlocked = true;
                }
              },
              true
            );
          }
        } catch {}

        const WrappedWorker = new Proxy(OrigWorker, {
          construct(target, args, newTarget) {
            if (!state.braveCloak || workerBlobBlocked) {
              return Reflect.construct(target, args, newTarget);
            }
            const scriptURL = args && args[0];
            const options = args && args[1];
            let absUrl = "";
            try {
              const base = (win.location && win.location.href) || undefined;
              const parsed = new win.URL(String(scriptURL), base);
              if (parsed.protocol === "http:" || parsed.protocol === "https:") {
                absUrl = parsed.href;
              }
            } catch {
              absUrl = "";
            }

            if (!absUrl) {
              return Reflect.construct(target, args, newTarget);
            }

            const isModule = Boolean(options && options.type === "module");
            const { major, full } = getChromeVersions(win);
            const bootstrap = buildWorkerBootstrap(absUrl, isModule, major, full);
            let blobUrl = "";
            try {
              const blob = new win.Blob([bootstrap], { type: "application/javascript" });
              blobUrl = win.URL.createObjectURL(blob);
              const worker = Reflect.construct(target, [blobUrl, options], newTarget);
              if (typeof win.setTimeout === "function") {
                win.setTimeout(() => {
                  try {
                    win.URL.revokeObjectURL(blobUrl);
                  } catch {}
                }, 10000);
              }
              return worker;
            } catch (err) {
              if (err && (err.name === "SecurityError" || /Content Security Policy|CSP/i.test(String(err.message || "")))) {
                workerBlobBlocked = true;
              }
              if (blobUrl) {
                try {
                  win.URL.revokeObjectURL(blobUrl);
                } catch {}
              }
              return Reflect.construct(target, args, newTarget);
            }
          }
        });
        nativeStrings.set(WrappedWorker, "function Worker() { [native code] }");
        Object.defineProperty(win, "Worker", {
          value: WrappedWorker,
          writable: true,
          enumerable: false,
          configurable: true
        });
      }
    } catch {}

    try {
      const IFrameProto = win.HTMLIFrameElement && win.HTMLIFrameElement.prototype;
      if (IFrameProto) {
        const cwDesc = Object.getOwnPropertyDescriptor(IFrameProto, "contentWindow");
        if (cwDesc && typeof cwDesc.get === "function") {
          const origCwGet = cwDesc.get;
          const getCw = maskFunction(
            function () {
              const childWin = origCwGet.call(this);
              try {
                if (childWin) cloakWindow(childWin);
              } catch {}
              return childWin;
            },
            "get contentWindow",
            0
          );
          Object.defineProperty(IFrameProto, "contentWindow", {
            get: getCw,
            set: undefined,
            enumerable: true,
            configurable: true
          });
        }

        const cdDesc = Object.getOwnPropertyDescriptor(IFrameProto, "contentDocument");
        if (cdDesc && typeof cdDesc.get === "function") {
          const origCdGet = cdDesc.get;
          const getCd = maskFunction(
            function () {
              const doc = origCdGet.call(this);
              try {
                if (doc && doc.defaultView) cloakWindow(doc.defaultView);
              } catch {}
              return doc;
            },
            "get contentDocument",
            0
          );
          Object.defineProperty(IFrameProto, "contentDocument", {
            get: getCd,
            set: undefined,
            enumerable: true,
            configurable: true
          });
        }
      }
    } catch {}
  }

  function restoreBrave(win) {
    if (!win || typeof win !== "object") return;
    try {
      const saved = savedBraveDescs.get(win);
      if (saved) {
        if (saved.protoDesc && win.Navigator && win.Navigator.prototype) {
          try {
            Object.defineProperty(win.Navigator.prototype, "brave", saved.protoDesc);
          } catch {}
        }
        if (saved.ownDesc && win.navigator) {
          try {
            Object.defineProperty(win.navigator, "brave", saved.ownDesc);
          } catch {}
        }
      }
      cloakedWindows.delete(win);
    } catch {}
  }

  cloakWindow(window);

  // Lifecycle and bridge sync

  let observer = null;
  let observerActive = false;
  function syncObserver() {
    if (!observer) return;
    const needed = state.antiAdblock || state.unlockInteraction;
    if (needed && !observerActive) {
      try {
        observer.observe(document.documentElement || document, { childList: true, subtree: true });
        observerActive = true;
      } catch {}
    } else if (!needed && observerActive) {
      try {
        observer.disconnect();
        observerActive = false;
      } catch {}
    }
  }

  document.addEventListener("__brave_addon_config__", (e) => {
    const cfg = e && e.detail;
    if (!cfg || typeof cfg !== "object") return;
    if (typeof cfg.braveCloak === "boolean") state.braveCloak = cfg.braveCloak;
    if (typeof cfg.antiAdblock === "boolean") state.antiAdblock = cfg.antiAdblock;
    if (typeof cfg.unlockInteraction === "boolean") state.unlockInteraction = cfg.unlockInteraction;
    if (typeof cfg.keepAlive === "boolean") state.keepAlive = cfg.keepAlive;
    if (state.braveCloak) {
      cloakWindow(window);
    } else {
      restoreBrave(window);
    }
    syncUnlockStyles();
    syncBackgroundMode();
    syncObserver();
    if (state.antiAdblock) {
      cleanAdblockOverlays();
    } else {
      cleanupGlobalMocks();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        syncUnlockStyles();
        cleanAdblockOverlays();
        if (state.antiAdblock) {
          nativeSetTimeout(() => cleanAdblockOverlays(), 500);
          nativeSetTimeout(() => cleanAdblockOverlays(), 1500);
        }
      },
      { once: true }
    );
  } else {
    syncUnlockStyles();
    cleanAdblockOverlays();
    if (state.antiAdblock) {
      nativeSetTimeout(() => cleanAdblockOverlays(), 500);
      nativeSetTimeout(() => cleanAdblockOverlays(), 1500);
    }
  }

  try {
    if (typeof MutationObserver === "function") {
      observer = new MutationObserver((mutations) => {
        let hadRemoval = false;
        const added = [];
        for (let i = 0; i < mutations.length; i++) {
          const m = mutations[i];
          if (m.removedNodes && m.removedNodes.length > 0) hadRemoval = true;
          if (m.addedNodes && m.addedNodes.length > 0) {
            for (let j = 0; j < m.addedNodes.length; j++) {
              added.push(m.addedNodes[j]);
            }
          }
        }
        if (state.antiAdblock && added.length > 0) {
          scheduleOverlayClean(added);
        }
        if (hadRemoval && state.unlockInteraction && !document.getElementById(UNLOCK_STYLE_ID)) {
          syncUnlockStyles();
        }
      });
      syncObserver();
    }
  } catch {
  }

  try {
    document.dispatchEvent(new CustomEvent("__brave_addon_req__"));
  } catch {
  }
})();
