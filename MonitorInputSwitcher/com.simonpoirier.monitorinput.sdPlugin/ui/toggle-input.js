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
    populateMonitorDropdown(payload.monitors, _savedSettings);
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
  var monitorSelect = document.getElementById("monitorIndex");
  var selectedOption = monitorSelect.options[monitorSelect.selectedIndex];
  var monitorDescription = selectedOption ? (selectedOption.dataset.description || "") : "";
  var monitorId = selectedOption ? (selectedOption.dataset.deviceId || "") : "";

  var s = {
    monitorIndex: parseInt(monitorSelect.value, 10),
    monitorDescription: monitorDescription,
    monitorId: monitorId,
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
  requestMonitors();
});

// Detect current input button
document.getElementById("detect").addEventListener("click", function () {
  document.getElementById("detected").textContent = " Detecting…";
  sendToPlugin({ event: "detectInput" });
});
