"use strict";

(function () {
  if (location.protocol !== "http:" && location.protocol !== "https:") {
    return;
  }

  const DEFAULT_GLOBAL = {
    braveCloak: true,
    antiAdblock: true,
    unlockInteraction: true,
    keepAlive: true
  };

  const isCaptchaOrAuthFrame =
    /(^|\.)(recaptcha\.net|hcaptcha\.com|challenges\.cloudflare\.com)$/i.test(location.hostname) ||
    (location.hostname === "www.google.com" && location.pathname.startsWith("/recaptcha/"));

  function dispatchConfig(cfg) {
    try {
      document.dispatchEvent(new CustomEvent("__brave_addon_config__", { detail: cfg }));
    } catch {
    }
  }

  if (isCaptchaOrAuthFrame) {
    const disabled = { braveCloak: false, antiAdblock: false, unlockInteraction: false, keepAlive: false };
    dispatchConfig(disabled);
    document.addEventListener("__brave_addon_req__", () => dispatchConfig(disabled));
    return;
  }

  function resolveConfig(data) {
    const globalCfg = { ...DEFAULT_GLOBAL, ...(data && data.global ? data.global : {}) };
    const host = location.hostname;
    const siteOverrides = host && data && data.sites && data.sites[host] ? data.sites[host] : {};
    return {
      braveCloak: typeof siteOverrides.braveCloak === "boolean" ? siteOverrides.braveCloak : globalCfg.braveCloak,
      antiAdblock: typeof siteOverrides.antiAdblock === "boolean" ? siteOverrides.antiAdblock : globalCfg.antiAdblock,
      unlockInteraction: typeof siteOverrides.unlockInteraction === "boolean" ? siteOverrides.unlockInteraction : globalCfg.unlockInteraction,
      keepAlive: typeof siteOverrides.keepAlive === "boolean" ? siteOverrides.keepAlive : globalCfg.keepAlive
    };
  }

  let currentCfg = { ...DEFAULT_GLOBAL };

  function syncFromStorage() {
    chrome.storage.local.get(["global", "sites"]).then((data) => {
      currentCfg = resolveConfig(data);
      dispatchConfig(currentCfg);
    }).catch(() => {
      dispatchConfig(currentCfg);
    });
  }

  document.addEventListener("__brave_addon_req__", () => {
    dispatchConfig(currentCfg);
  });

  // Unthrottled background-port ticker so hidden tabs stay active without page CSP violations.
  let tickPort = null;
  let fallbackTickId = null;
  let tickActive = false;

  function emitTick() {
    try {
      document.dispatchEvent(new CustomEvent("__brave_addon_tick__"));
    } catch {
    }
  }

  function stopFallbackTicker() {
    tickActive = false;
    if (tickPort) {
      try {
        tickPort.disconnect();
      } catch {}
      tickPort = null;
    }
    if (fallbackTickId !== null) {
      clearInterval(fallbackTickId);
      fallbackTickId = null;
    }
  }

  document.addEventListener("__brave_addon_tick_ctrl__", (e) => {
    const active = Boolean(e && e.detail && e.detail.active);
    if (!active) {
      stopFallbackTicker();
      return;
    }
    tickActive = true;
    if (tickPort || fallbackTickId !== null) return;
    try {
      tickPort = chrome.runtime.connect({ name: "brave-addon-tick" });
      tickPort.onMessage.addListener(emitTick);
      tickPort.onDisconnect.addListener(() => {
        const err = chrome.runtime && chrome.runtime.lastError;
        tickPort = null;
        if (!chrome.runtime || !chrome.runtime.id || (err && /back\/forward cache/i.test(err.message || ""))) {
          tickActive = false;
          return;
        }
        if (tickActive && fallbackTickId === null) {
          fallbackTickId = setInterval(emitTick, 100);
        }
      });
    } catch {
      tickPort = null;
      fallbackTickId = setInterval(emitTick, 100);
    }
  });

  window.addEventListener("pagehide", stopFallbackTicker);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!changes.global && !changes.sites) return;
    syncFromStorage();
  });

  syncFromStorage();
})();
