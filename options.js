const DEFAULT_SETTINGS = {
  thresholdSeconds: 30,
  language: "en",
  alertModes: { voice: true, notification: true, banner: true, sound: false },
  customMessage: "Time is running low!",
  voiceRate: 1.0,
  voicePitch: 1.0,
  voiceVolume: 1.0,
};

function load() {
  chrome.storage.sync.get(["settings"], ({ settings }) => {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    document.getElementById("threshold").value = s.thresholdSeconds;
    document.getElementById("language").value = s.language;
    document.getElementById("mode-voice").checked = !!s.alertModes.voice;
    document.getElementById("mode-notif").checked = !!s.alertModes.notification;
    document.getElementById("mode-banner").checked = !!s.alertModes.banner;
    document.getElementById("mode-sound").checked = !!s.alertModes.sound;
    document.getElementById("message").value = s.customMessage || "";
    document.getElementById("rate").value = s.voiceRate;
    document.getElementById("pitch").value = s.voicePitch;
    document.getElementById("volume").value = s.voiceVolume;
  });
}

function save() {
  const s = {
    thresholdSeconds: Number(document.getElementById("threshold").value) || 30,
    language: document.getElementById("language").value,
    alertModes: {
      voice: document.getElementById("mode-voice").checked,
      notification: document.getElementById("mode-notif").checked,
      banner: document.getElementById("mode-banner").checked,
      sound: document.getElementById("mode-sound").checked,
    },
    customMessage: document.getElementById("message").value,
    voiceRate: Number(document.getElementById("rate").value) || 1.0,
    voicePitch: Number(document.getElementById("pitch").value) || 1.0,
    voiceVolume: Number(document.getElementById("volume").value) || 1.0,
  };
  chrome.storage.sync.set({ settings: s }, () => {
    const btn = document.getElementById("save");
    btn.textContent = "Saved";
    setTimeout(() => (btn.textContent = "Save"), 1200);
  });
}

function testAlert() {
  save();
  chrome.storage.sync.get(["settings"], ({ settings }) => {
    const s = settings || DEFAULT_SETTINGS;
    chrome.runtime.sendMessage({ type: "TRIGGER_ALERT" });
    // also preview voice locally
    try {
      if (s.alertModes.voice && window.speechSynthesis) {
        const utter = new SpeechSynthesisUtterance(
          s.customMessage || "Time is running low!"
        );
        utter.rate = s.voiceRate;
        utter.pitch = s.voicePitch;
        utter.volume = s.voiceVolume;
        const voices = window.speechSynthesis.getVoices();
        const v = voices.find((v) =>
          v.lang?.toLowerCase().startsWith(s.language)
        );
        if (v) utter.voice = v;
        window.speechSynthesis.speak(utter);
      }
    } catch (_) {}
  });
}

document.addEventListener("DOMContentLoaded", () => {
  load();
  document.getElementById("save").addEventListener("click", save);
  document.getElementById("test").addEventListener("click", testAlert);
});
