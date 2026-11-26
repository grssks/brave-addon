"use strict";

(function () {
  const DEFAULT_GLOBAL = {
    braveCloak: true,
    antiAdblock: true,
    unlockInteraction: true,
    keepAlive: true
  };

  const FEATURES = ["braveCloak", "antiAdblock", "unlockInteraction", "keepAlive"];

  const hostLabel = document.getElementById("host-label");
  const tabSite = document.getElementById("tab-site");
  const tabGlobal = document.getElementById("tab-global");
  const errorBanner = document.getElementById("error-banner");
  const errorText = document.getElementById("error-text");
  const reloadBanner = document.getElementById("reload-banner");
  const btnReload = document.getElementById("btn-reload");
  const footerActions = document.getElementById("footer-actions");
  const btnReset = document.getElementById("btn-reset");

  const inputs = {
    braveCloak: document.getElementById("opt-braveCloak"),
    antiAdblock: document.getElementById("opt-antiAdblock"),
    unlockInteraction: document.getElementById("opt-unlockInteraction"),
    keepAlive: document.getElementById("opt-keepAlive")
  };

  let activeTabId = null;
  let activeHost = "";
  let scope = "site"; // "site" | "global"
  let globalCfg = { ...DEFAULT_GLOBAL };
  let sitesMap = {};

  function showError(msg) {
    errorText.textContent = msg;
    errorBanner.hidden = false;
  }

  function hideError() {
    errorBanner.hidden = true;
  }

  function getSiteOverrides() {
    if (!activeHost || !sitesMap[activeHost] || typeof sitesMap[activeHost] !== "object") {
      return {};
    }
    return sitesMap[activeHost];
  }

  function getResolvedForSite() {
    const ov = getSiteOverrides();
    return {
      braveCloak: typeof ov.braveCloak === "boolean" ? ov.braveCloak : globalCfg.braveCloak,
      antiAdblock: typeof ov.antiAdblock === "boolean" ? ov.antiAdblock : globalCfg.antiAdblock,
      unlockInteraction: typeof ov.unlockInteraction === "boolean" ? ov.unlockInteraction : globalCfg.unlockInteraction,
      keepAlive: typeof ov.keepAlive === "boolean" ? ov.keepAlive : globalCfg.keepAlive
    };
  }

  function render() {
    const hasHost = Boolean(activeHost);
    tabSite.disabled = !hasHost;
    if (!hasHost && scope === "site") {
      scope = "global";
    }

    tabSite.setAttribute("aria-selected", String(scope === "site"));
    tabGlobal.setAttribute("aria-selected", String(scope === "global"));

    const values = scope === "site" ? getResolvedForSite() : globalCfg;
    for (const key of FEATURES) {
      inputs[key].checked = Boolean(values[key]);
    }

    const hasOverrides = hasHost && scope === "site" && Object.keys(getSiteOverrides()).length > 0;
    footerActions.hidden = !hasOverrides;
  }

  async function persistStorage() {
    hideError();
    try {
      await chrome.storage.local.set({
        global: globalCfg,
        sites: sitesMap
      });
    } catch {
      showError("Could not save settings.");
    }
  }

  function setScope(nextScope) {
    if (nextScope === "site" && !activeHost) return;
    scope = nextScope;
    render();
  }

  tabSite.addEventListener("click", () => setScope("site"));
  tabGlobal.addEventListener("click", () => setScope("global"));

  const scopeTabs = [tabSite, tabGlobal];
  for (let i = 0; i < scopeTabs.length; i++) {
    scopeTabs[i].addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const next = scopeTabs[(i + 1) % scopeTabs.length];
      if (!next.disabled) {
        next.focus();
        next.click();
      }
    });
  }

  for (const key of FEATURES) {
    inputs[key].addEventListener("change", async (e) => {
      const checked = Boolean(e.target.checked);
      if (scope === "global") {
        globalCfg[key] = checked;
      } else if (activeHost) {
        const current = getSiteOverrides();
        sitesMap[activeHost] = { ...current, [key]: checked };
      }
      if (activeHost && (key === "antiAdblock" || key === "braveCloak")) {
        reloadBanner.hidden = false;
      }
      render();
      await persistStorage();
    });
  }

  btnReset.addEventListener("click", async () => {
    if (!activeHost) return;
    const prevOverrides = getSiteOverrides();
    if ("antiAdblock" in prevOverrides || "braveCloak" in prevOverrides) {
      reloadBanner.hidden = false;
    }
    delete sitesMap[activeHost];
    render();
    await persistStorage();
  });

  btnReload.addEventListener("click", async () => {
    if (typeof activeTabId !== "number") return;
    try {
      await chrome.tabs.reload(activeTabId);
      reloadBanner.hidden = true;
    } catch {
      showError("Could not reload tab.");
    }
  });

  async function init() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        activeTabId = tab.id;
        if (tab.url) {
          try {
            const parsed = new URL(tab.url);
            if (parsed.protocol === "http:" || parsed.protocol === "https:") {
              activeHost = parsed.hostname;
            }
          } catch {
            activeHost = "";
          }
        }
      }
      hostLabel.textContent = activeHost || "Unsupported page";
      if (!activeHost) {
        scope = "global";
      }

      const data = await chrome.storage.local.get(["global", "sites"]);
      globalCfg = { ...DEFAULT_GLOBAL, ...(data && data.global ? data.global : {}) };
      sitesMap = data && data.sites && typeof data.sites === "object" ? { ...data.sites } : {};
      render();
    } catch {
      hostLabel.textContent = "Unavailable";
      showError("Failed to load extension settings.");
    }
  }

  init();
})();
