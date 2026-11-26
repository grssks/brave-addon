"use strict";

const DEFAULT_GLOBAL = {
  braveCloak: true,
  antiAdblock: true,
  unlockInteraction: true,
  keepAlive: true
};

const ALL_RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "other"
];

function getChromeVersionsFromUA() {
  const ua = (self.navigator && self.navigator.userAgent) || "";
  const match = ua.match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/);
  const full = match ? match[1] : "136.0.0.0";
  const major = full.split(".")[0] || "136";
  return { major, full };
}

function normalizeBrandList(list, fallbackVersion) {
  const seen = new Set();
  const normalized = [];

  if (Array.isArray(list)) {
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const rawBrand = typeof item.brand === "string" ? item.brand : "";
      const brand = rawBrand.toLowerCase().includes("brave") ? "Google Chrome" : rawBrand;
      const key = brand.toLowerCase();
      if (!brand || seen.has(key)) continue;
      seen.add(key);
      normalized.push({ brand, version: item.version });
    }
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

const serializeBrands = (list) =>
  list
    .map(({ brand, version }) => {
      const escapedBrand = String(brand).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const escapedVer = String(version).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return `"${escapedBrand}";v="${escapedVer}"`;
    })
    .join(", ");

async function syncClientHintRules() {
  if (!chrome.declarativeNetRequest) return;

  let stored = {};
  try {
    stored = await chrome.storage.local.get(["global", "sites"]);
  } catch {
    stored = {};
  }

  const globalCfg = stored && stored.global ? stored.global : {};
  const globalCloak = globalCfg.braveCloak !== false;
  const sitesMap = stored && stored.sites && typeof stored.sites === "object" ? stored.sites : {};

  const excludedHosts = [];
  const includedHosts = [];
  for (const [hostname, overrides] of Object.entries(sitesMap)) {
    if (!hostname || !overrides || typeof overrides !== "object") continue;
    if (overrides.braveCloak === false) excludedHosts.push(hostname);
    else if (overrides.braveCloak === true) includedHosts.push(hostname);
  }

  if (!globalCloak && includedHosts.length === 0) {
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [1],
        addRules: []
      });
      if (chrome.declarativeNetRequest.updateEnabledRulesets) {
        chrome.declarativeNetRequest.updateEnabledRulesets({
          disableRulesetIds: ["ruleset_client_hints"]
        }).catch(() => {});
      }
    } catch {}
    return;
  }

  const { major, full } = getChromeVersionsFromUA();
  const uaData = self.navigator && self.navigator.userAgentData;

  const rawLowBrands = uaData && Array.isArray(uaData.brands) && uaData.brands.length
    ? uaData.brands
    : [
        { brand: "Chromium", version: major },
        { brand: "Google Chrome", version: major },
        { brand: "Not.A/Brand", version: "99" }
      ];
  const lowBrands = normalizeBrandList(rawLowBrands, major);

  let rawFullBrands = null;
  if (uaData && typeof uaData.getHighEntropyValues === "function") {
    try {
      const high = await uaData.getHighEntropyValues(["fullVersionList"]);
      if (high && Array.isArray(high.fullVersionList) && high.fullVersionList.length) {
        rawFullBrands = high.fullVersionList;
      }
    } catch {}
  }

  if (!rawFullBrands) {
    rawFullBrands = [
      { brand: "Chromium", version: full },
      { brand: "Google Chrome", version: full },
      { brand: "Not.A/Brand", version: "99.0.0.0" }
    ];
  }
  const fullBrands = normalizeBrandList(rawFullBrands, full);

  const condition = {
    urlFilter: "*",
    resourceTypes: ALL_RESOURCE_TYPES
  };
  if (globalCloak && excludedHosts.length > 0) {
    condition.excludedRequestDomains = excludedHosts;
  } else if (!globalCloak && includedHosts.length > 0) {
    condition.requestDomains = includedHosts;
  }

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: [
        {
          id: 1,
          priority: 2,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              {
                header: "sec-ch-ua",
                operation: "set",
                value: serializeBrands(lowBrands)
              },
              {
                header: "sec-ch-ua-full-version-list",
                operation: "set",
                value: serializeBrands(fullBrands)
              }
            ]
          },
          condition
        }
      ]
    });

    if (chrome.declarativeNetRequest.updateEnabledRulesets) {
      chrome.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: ["ruleset_client_hints"]
      }).catch(() => {});
    }
  } catch {}
}

let syncChain = Promise.resolve();
function queueSyncClientHintRules() {
  syncChain = syncChain.then(syncClientHintRules, syncClientHintRules);
  return syncChain;
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const stored = await chrome.storage.local.get(["global", "sites"]);
    const updates = {};
    if (!stored.global || typeof stored.global !== "object") {
      updates.global = { ...DEFAULT_GLOBAL };
    } else {
      updates.global = {
        braveCloak: typeof stored.global.braveCloak === "boolean" ? stored.global.braveCloak : DEFAULT_GLOBAL.braveCloak,
        antiAdblock: typeof stored.global.antiAdblock === "boolean" ? stored.global.antiAdblock : DEFAULT_GLOBAL.antiAdblock,
        unlockInteraction: typeof stored.global.unlockInteraction === "boolean" ? stored.global.unlockInteraction : DEFAULT_GLOBAL.unlockInteraction,
        keepAlive: typeof stored.global.keepAlive === "boolean" ? stored.global.keepAlive : DEFAULT_GLOBAL.keepAlive
      };
    }
    if (!stored.sites || typeof stored.sites !== "object") {
      updates.sites = {};
    }
    await chrome.storage.local.set(updates);
    if (chrome.action) {
      chrome.action.setBadgeText({ text: "" }).catch(() => {});
    }
  } catch {
  }
  queueSyncClientHintRules();
});

if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(queueSyncClientHintRules);
}

if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!changes.global && !changes.sites) return;
    queueSyncClientHintRules();
  });
}

// Unthrottled background-port ticker so hidden tabs run timers without page CSP errors.
chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== "brave-addon-tick") return;
  const intervalId = setInterval(() => {
    try {
      port.postMessage("tick");
    } catch {
      clearInterval(intervalId);
    }
  }, 100);
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    clearInterval(intervalId);
  });
});

queueSyncClientHintRules();
