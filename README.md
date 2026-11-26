# Brave Addon

A Manifest V3 extension for Brave and Chrome that masks Brave browser detection, bypasses anti-adblock checks, restores copy and right-click, and keeps background tab timers running.

- **Manifest V3, zero build step:** Plain JavaScript, HTML, CSS, and Declarative Net Request rules. Load directly or install from a release zip.
- **Global and per-site toggles:** Configure defaults globally or override individual features per hostname from the popup.
- **Zero-idle-CPU keep-alive:** Background timer unthrottling runs only while a hidden tab has pending timers or animation frames.
- **Privacy-safe defaults:** Leaves Brave's `Sec-GPC` header and browser Memory Saver intact, and excludes captcha/auth frames.

---

## Features

- **Spoof Google Chrome:** Removes `navigator.brave` (restorable when disabled per site), replaces or inserts `"Google Chrome"` in `navigator.userAgentData`, rewrites `sec-ch-ua` and `sec-ch-ua-full-version-list` HTTP headers via DNR, cloaks same-origin iframes, and patches Dedicated Web Workers with relative-URL resolution for `importScripts()`, `fetch()`, and `XMLHttpRequest.open()`. Leaves `Sec-GPC` untouched.
- **Anti-Adblock Bypass:** Spoofs ad-bait layout and visibility checks (`offsetHeight`, `offsetWidth`, `getBoundingClientRect`, `getComputedStyle`, `offsetParent`, `checkVisibility`), stubs common detector globals (`canRunAds`, `adsbygoogle`, `fuckAdBlock`) with cleanup on disable, spoofs third-party ad-probe failures (`fetch`, `XMLHttpRequest`, `<script>`, `1x1` `<img>`) while allowlisting major non-ad CDNs and SDKs, and removes anti-adblock modal walls while restoring scroll and clearing blur.
- **Unlock Copy & Right-Click:** Restores text selection, copy, cut, paste on inputs, drag, and context menus without breaking interactive app controls (`contentEditable`, `[draggable="true"]`, `<canvas>`, `[role="application|grid|treegrid"]`).
- **Background Tab Keep-Alive:** Spoofs page visibility and window focus so background countdowns keep running via an on-demand Web Worker (0 wakeups when idle, with a background service-worker port fallback when strict CSP blocks `blob:` workers). Browser Memory Saver stays unaffected.

---

## Installation

Prebuilt release zips are on the GitHub [Releases](../../releases) page.

1. Download the latest `brave-addon-*.zip` from [Releases](../../releases) and extract it.
2. Open `brave://extensions` or `chrome://extensions`.
3. Turn on **Developer mode**, click **Load unpacked**, and select the extracted folder.

Or install from source by cloning this repository and selecting the cloned folder with **Load unpacked** (no build step required).

---

## Notes & Limitations

- **Chrome Web Store & Internal Pages:** Chromium and Brave block all extensions (content scripts and DNR rules) on `chromewebstore.google.com`, `chrome.google.com/webstore`, `brave://`, and `chrome://` pages.
- **Brave Wallet:** If you have Brave Wallet enabled, some sites can still detect `window.solanaBrave`. Disable Brave Wallet in browser settings if a site still detects Brave.
- **Fingerprinting / Farbling:** Extensions cannot disable Brave's built-in Canvas/WebGL/Audio farbling. If a site detects Brave through fingerprinting, set Brave Shields Fingerprinting blocking to Disabled for that site.
- **Server-Side Checks:** Server-verified countdowns and server-side restrictions cannot be bypassed client-side.
- **Captcha Frames:** Captcha frames (`recaptcha.net`, `hcaptcha.com`, `challenges.cloudflare.com`, `www.google.com/recaptcha/`) are excluded so verification works normally.

---

## Project Structure

```text
brave-addon/
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── background.js    # Service worker: DNR Sec-CH-UA header rules & CSP fallback tick port
├── bridge.js        # Isolated-world bridge: storage sync and CSP fallback port
├── main-world.js    # Main-world patches: Brave Cloak, Anti-Adblock, Unlock, Keep-Alive
├── manifest.json    # Extension manifest (MV3)
├── popup.html       # Popup markup
├── popup.css        # Popup styles (light & dark theme)
├── popup.js         # Popup state and global/per-site toggles
├── rules.json       # Static DNR fallback ruleset
├── test.js          # Node.js VM unit test suite
├── .gitattributes
├── .gitignore
└── LICENSE
```

---

## Testing

Requires Node.js:

```bash
node --check background.js
node --check bridge.js
node --check main-world.js
node --check popup.js
node --check test.js
node test.js
```

---

## License

[MIT](LICENSE)

---

## Credits

- [bypass-all-shortlinks-debloated](https://codeberg.org/gongchandang49/bypass-all-shortlinks-debloated) (originally by BloggerPemula, forked by Amm0ni4 and gongchandang49) for reference on anti-adblock, interaction unlock, and visibility/focus helpers.
- [Brave-Detection-Blocker-Chrome-Extension](https://github.com/andrei0x309/Brave-Detection-Blocker-Chrome-Extension) by andrei0x309 for reference on `navigator.brave` and Brave Wallet detection notes.
