/**
 * Property Inspector for the Set Monitor Input action.
 * Depends on common.js being loaded first.
 */

var _savedSettings = {};

function onSettingsReceived(settings) {
  _savedSettings = settings;

  // Input source
  var known = ["0x01", "0x02", "0x03", "0x04", "0x0F", "0x10", "0x11", "0x12", "0x1B"];
  var src = settings.inputSource || "0x11";
  if (known.indexOf(src) >= 0) {
    document.getElementById("inputSource").value = src;
    document.getElementById("customField").style.display = "none";
  } else {
    document.getElementById("inputSource").value = "custom";
    document.getElementById("customInput").value = src;
    document.getElementById("customField").style.display = "block";
  }
}

function onPluginMessage(payload) {
  if (payload.event === "monitorList") {
    populateMonitorDropdown(payload.monitors, _savedSettings);
  }
}

function getInputSourceValue() {
  var sel = document.getElementById("inputSource").value;
  if (sel === "custom") {
    return document.getElementById("customInput").value.trim() || "0x11";
  }
  return sel;
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
    inputSource: getInputSourceValue()
  };
  _savedSettings = s;
  saveSettings(s);
}

// Input source dropdown toggle for custom field
document.getElementById("inputSource").addEventListener("change", function () {
  document.getElementById("customField").style.display =
    this.value === "custom" ? "block" : "none";
  save();
});

// Save on any change
document.getElementById("monitorIndex").addEventListener("change", save);
document.getElementById("customInput").addEventListener("change", save);

// Refresh monitors button
document.getElementById("refresh").addEventListener("click", function () {
  requestMonitors();
});
