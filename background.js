// Background service worker: handles notifications and TTS centrally

const DEFAULT_SETTINGS = {
  thresholdSeconds: 30,
  language: "en",
  alertModes: { voice: true, notification: true, banner: true, sound: false },
  customMessage: "Time is running low!",
  voiceRate: 1.0,
  voicePitch: 1.0,
  voiceVolume: 1.0,
};

const I18N_MESSAGES = {
  en: "Your time is low",
  tr: "Süren azaldı",
  hu: "Kevés az időd",
  es: "Te queda poco tiempo",
  de: "Deine Zeit wird knapp",
  it: "Il tuo tempo è basso",
  pt: "Seu tempo está acabando",
};

// Sound fallback (short beep). We'll synthesize via WebAudio in content page banner; here it's only for notification sound toggling.

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(["settings"], ({ settings }) => {
    if (!settings) {
      chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
    }
  });
});

function getMessageText(settings) {
  if (settings.customMessage && settings.customMessage.trim().length > 0)
    return settings.customMessage;
  return I18N_MESSAGES[settings.language] || I18N_MESSAGES.en;
}

async function notify(settings) {
  const message = getMessageText(settings);
  // Desktop notification
  if (settings.alertModes.notification && chrome.notifications) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon128.png",
      title: "Chess.com Alert",
      message,
    });
  }
}

// Handle messages from content script to trigger alerts or fetch settings
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "GET_SETTINGS") {
    chrome.storage.sync.get(["settings"], ({ settings }) => {
      sendResponse({ settings: { ...DEFAULT_SETTINGS, ...settings } });
    });
    return true;
  }
  if (msg?.type === "TRIGGER_ALERT") {
    chrome.storage.sync.get(["settings"], ({ settings }) => {
      const merged = { ...DEFAULT_SETTINGS, ...settings };
      notify(merged);
      // Ask content script to do voice/sound/banner locally (so it can access page audio context & DOM)
      if (sender.tab && merged.alertModes) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: "PAGE_ALERT",
          settings: merged,
        });
      }
    });
    return false;
  }
  return false;
});
