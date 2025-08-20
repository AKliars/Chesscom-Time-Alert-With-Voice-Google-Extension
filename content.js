// Content script: detects chess.com clocks and triggers alerts via background

const STATE = {
  settings: null,
  lastAlertAt: 0,
  lastSeenSeconds: null,
  lastMySeconds: null,
  alertedOnce: false,
  lastUrl: null,
  minMySecondsSeen: Infinity,
};

const SELECTORS = {
  // Supports both new and legacy board UI selectors
  myClock: [
    ".board-player-bottom .clock",
    ".board-player-bottom [data-cy='clock-time']",
    ".board-player-bottom .clock-time-monospace",
    ".player-row-component.bottom .time-font",
    "[data-cy='clock-player-bottom'] .clock",
    "div[data-test-element='bottom-player'] .clock-component",
    ".board-layout-player-bottom .clock",
    ".board-layout-player-bottom .clock .time",
  ],
  opponentClock: [
    ".board-player-top .clock",
    ".board-player-top [data-cy='clock-time']",
    ".board-player-top .clock-time-monospace",
    ".player-row-component.top .time-font",
    "[data-cy='clock-player-top'] .clock",
    "div[data-test-element='top-player'] .clock-component",
    ".board-layout-player-top .clock",
    ".board-layout-player-top .clock .time",
  ],
  moveIndicators: [".highlight.move", ".move-list-item.current"],
};

function pickFirstSelector(selectors) {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el) return el;
  }
  return null;
}

function findClockElements() {
  // Try explicit selectors first
  let my = pickFirstSelector(SELECTORS.myClock);
  let opp = pickFirstSelector(SELECTORS.opponentClock);
  if (my && opp) return { my, opp };
  // Fallback: gather all plausible clock nodes and pick top/bottom by Y position
  const nodeList = document.querySelectorAll(
    "[data-cy='clock-time'], .clock-time-monospace, .clock .time, .clock"
  );
  const candidates = Array.from(nodeList)
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(
      (x) =>
        Number.isFinite(x.rect.top) && x.rect.width > 0 && x.rect.height > 0
    )
    // de-duplicate nested .time inside .clock (prefer most specific: smallest area)
    .sort(
      (a, b) => a.rect.height * a.rect.width - b.rect.height * b.rect.width
    );
  if (candidates.length < 2) return { my: my || null, opp: opp || null };
  // Choose the visually highest as opponent, lowest as me (bottom)
  candidates.sort((a, b) => a.rect.top - b.rect.top);
  const top = candidates[0]?.el || null;
  const bottom = candidates[candidates.length - 1]?.el || null;
  return { my: my || bottom, opp: opp || top };
}

function parseClockText(text) {
  // Supports formats: H:MM:SS, MM:SS, SS, and decimal seconds in the last field (e.g., 0:09.8)
  const raw = (text || "").trim();
  if (!raw) return null;
  const parts = raw.split(":");
  if (parts.length === 0) return null;
  let seconds = 0;
  const parseIntSafe = (v) => {
    const n = parseInt((v || "").replace(/[^0-9]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  };
  const parseFloatSafe = (v) => {
    // Keep one decimal if present (e.g., "09.8" -> 9.8)
    const cleaned = (v || "").replace(/[^0-9.]/g, "");
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  };
  if (parts.length === 3) {
    seconds =
      parseIntSafe(parts[0]) * 3600 +
      parseIntSafe(parts[1]) * 60 +
      parseFloatSafe(parts[2]);
  } else if (parts.length === 2) {
    seconds = parseIntSafe(parts[0]) * 60 + parseFloatSafe(parts[1]);
  } else if (parts.length === 1) {
    seconds = parseFloatSafe(parts[0]);
  }
  return Number.isFinite(seconds) ? seconds : null;
}

function isMyClockRunning(myClockEl, opponentClockEl) {
  // chess.com toggles CSS class when active; also check blinking/active attribute
  const activeClassNames = [
    "clock-player-turn",
    "clock--active",
    "clock-running",
    "active",
  ];
  const isActive = (el) => {
    if (!el) return false;
    return (
      activeClassNames.some((c) => el.classList.contains(c)) ||
      el.getAttribute("data-active") === "true"
    );
  };
  return isActive(myClockEl) && !isActive(opponentClockEl);
}

function addOrUpdateBanner(text) {
  let banner = document.getElementById("chess-low-time-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "chess-low-time-banner";
    banner.style.position = "fixed";
    banner.style.top = "12px";
    banner.style.left = "50%";
    banner.style.transform = "translateX(-50%)";
    banner.style.zIndex = "99999";
    banner.style.padding = "10px 16px";
    banner.style.borderRadius = "8px";
    banner.style.background = "#b00020";
    banner.style.color = "#fff";
    banner.style.fontSize = "16px";
    banner.style.fontWeight = "600";
    document.body.appendChild(banner);
  }
  banner.textContent = text;
  banner.style.display = "block";
  setTimeout(() => banner && (banner.style.display = "none"), 3500);
}

function playBeep(volume = 1.0) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = volume;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 300);
  } catch (e) {
    // ignore
  }
}

function speak(message, settings) {
  try {
    if (!window.speechSynthesis) return;
    const utter = new SpeechSynthesisUtterance(message);
    utter.rate = settings.voiceRate ?? 1.0;
    utter.pitch = settings.voicePitch ?? 1.0;
    utter.volume = settings.voiceVolume ?? 1.0;
    // Attempt to pick voice by language
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((v) =>
      v.lang?.toLowerCase().startsWith(settings.language)
    );
    if (preferred) utter.voice = preferred;
    window.speechSynthesis.speak(utter);
  } catch (_) {}
}

function getMessage(settings) {
  const dict = {
    en: "Your time is low",
    tr: "Süren azaldı",
    hu: "Kevés az időd",
    es: "Te queda poco tiempo",
    de: "Deine Zeit wird knapp",
    it: "Il tuo tempo è basso",
    pt: "Seu tempo está acabando",
  };
  return (
    (settings.customMessage && settings.customMessage.trim()) ||
    dict[settings.language] ||
    dict.en
  );
}

function maybeAlert(seconds, myRunning) {
  if (!STATE.settings) return;
  if (!myRunning) return;
  if (STATE.alertedOnce) return;
  const threshold = Number(STATE.settings.thresholdSeconds) || 30;
  if (seconds > threshold) return;
  const now = Date.now();
  if (now - STATE.lastAlertAt < 4000) return; // avoid spam
  STATE.lastAlertAt = now;
  const message = getMessage(STATE.settings);
  chrome.runtime.sendMessage({ type: "TRIGGER_ALERT" });
  const modes = STATE.settings.alertModes || {};
  if (modes.banner) addOrUpdateBanner(message);
  if (modes.sound) playBeep(STATE.settings.voiceVolume ?? 1.0);
  if (modes.voice) speak(message, STATE.settings);
  STATE.alertedOnce = true;
}

function resetForNewGame() {
  STATE.alertedOnce = false;
  STATE.minMySecondsSeen = Infinity;
  STATE.lastMySeconds = null;
  STATE.lastSeenSeconds = null;
}

function tick() {
  // Reset if SPA navigation changed URL (likely new game)
  const href = location.href;
  if (STATE.lastUrl == null) STATE.lastUrl = href;
  if (href !== STATE.lastUrl) {
    STATE.lastUrl = href;
    resetForNewGame();
  }

  const { my: myClockEl, opp: oppClockEl } = findClockElements();
  if (!myClockEl || !oppClockEl) return;
  const myText = myClockEl.textContent || "";
  const oppText = oppClockEl.textContent || "";
  const mySec = parseClockText(myText);
  const oppSec = parseClockText(oppText);
  if (mySec == null || oppSec == null) return;
  // Track lowest seen to detect big jumps (new game/time added massively)
  if (mySec < STATE.minMySecondsSeen) STATE.minMySecondsSeen = mySec;
  if (
    Number.isFinite(STATE.minMySecondsSeen) &&
    mySec - STATE.minMySecondsSeen > 180
  ) {
    resetForNewGame();
    STATE.minMySecondsSeen = mySec;
  }
  const classSaysRunning = isMyClockRunning(myClockEl, oppClockEl);
  const decreasing =
    STATE.lastMySeconds != null ? mySec < STATE.lastMySeconds : false;
  const myRunning = classSaysRunning || decreasing;
  maybeAlert(mySec, myRunning);
  STATE.lastSeenSeconds = mySec;
  STATE.lastMySeconds = mySec;
}

function ensureSettings() {
  return new Promise((resolve) => {
    if (STATE.settings) return resolve(STATE.settings);
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (resp) => {
      STATE.settings = resp?.settings || null;
      resolve(STATE.settings);
    });
  });
}

function main() {
  ensureSettings().then(() => {
    STATE.lastUrl = location.href;
    setInterval(tick, 500);
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "PAGE_ALERT" && msg.settings) {
    STATE.settings = msg.settings;
  }
});

main();
