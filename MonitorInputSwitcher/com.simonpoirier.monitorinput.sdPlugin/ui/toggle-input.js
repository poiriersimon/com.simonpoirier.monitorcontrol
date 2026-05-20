/**
 * Property Inspector for the Toggle Monitor Input action.
 * Depends on common.js being loaded first.
 */

var _savedSettings = {};

function onSettingsReceived(settings) {
  _savedSettings = settings;
  document.getElementById("inputSources").value = settings.inputSources || "";
}

function onPluginMessage(payload) {
  if (payload.event === "monitorList") {
    populateMonitorDropdown(payload.monitors, _savedSettings.monitorIndex);
  }
  if (payload.event === "currentInput") {
    var code = payload.inputSource;
    var el = document.getElementById("detected");
    if (code >= 0) {
      el.textContent = " Current: 0x" + code.toString(16).toUpperCase().padStart(2, "0");
    } else {
      el.textContent = " Could not read input";
    }
  }
}

function save() {
  var s = {
    monitorIndex: parseInt(document.getElementById("monitorIndex").value, 10),
    inputSources: document.getElementById("inputSources").value.trim(),
    currentIndex: _savedSettings.currentIndex || 0
  };
  _savedSettings = s;
  saveSettings(s);
}

// Save on change
document.getElementById("monitorIndex").addEventListener("change", save);
document.getElementById("inputSources").addEventListener("change", save);

// Refresh monitors button
document.getElementById("refresh").addEventListener("click", function () {
  sendToPlugin({ event: "getMonitors" });
});

// Detect current input button
document.getElementById("detect").addEventListener("click", function () {
  document.getElementById("detected").textContent = " Detecting…";
  sendToPlugin({ event: "detectInput" });
});
