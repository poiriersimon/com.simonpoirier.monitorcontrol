/**
 * Shared PI ↔ plugin communication helpers.
 * Loaded by both set-input.html and toggle-input.html.
 */

/* globals */
let $ws = null;
let $uuid = null;
let $context = null;
let $actionInfo = null;

/**
 * Called by Stream Deck to initialise the PI WebSocket.
 */
function connectElgatoStreamDeckSocket(inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) {
  $uuid = inUUID;
  $actionInfo = JSON.parse(inActionInfo);
  // SDK v2: use inUUID as the context for all PI ↔ SD messages
  $context = inUUID;

  $ws = new WebSocket("ws://127.0.0.1:" + inPort);

  $ws.onopen = function () {
    $ws.send(JSON.stringify({ event: inRegisterEvent, uuid: $uuid }));
    // request saved settings
    $ws.send(JSON.stringify({ event: "getSettings", context: $context }));
    // ask plugin to enumerate monitors
    sendToPlugin({ event: "getMonitors" });
  };

  $ws.onmessage = function (evt) {
    var msg = JSON.parse(evt.data);
    if (msg.event === "didReceiveSettings") {
      onSettingsReceived(msg.payload.settings || {});
    }
    if (msg.event === "sendToPropertyInspector") {
      onPluginMessage(msg.payload || {});
    }
  };
}

function sendToPlugin(payload) {
  if (!$ws || $ws.readyState !== WebSocket.OPEN || !$context) return;
  $ws.send(JSON.stringify({
    event: "sendToPlugin",
    action: $actionInfo.action,
    context: $context,
    payload: payload
  }));
}

function saveSettings(settings) {
  if (!$ws || $ws.readyState !== WebSocket.OPEN || !$context) return;
  $ws.send(JSON.stringify({
    event: "setSettings",
    context: $context,
    payload: settings
  }));
}

/**
 * Populate the monitor dropdown with the list from the plugin.
 * @param {Array} monitors - [{index, description}]
 * @param {number|undefined} selectedIndex - currently saved monitor index
 */
function populateMonitorDropdown(monitors, selectedIndex) {
  var sel = document.getElementById("monitorIndex");
  sel.innerHTML = "";

  if (!monitors || monitors.length === 0) {
    var opt = document.createElement("option");
    opt.value = "0";
    opt.textContent = "No monitors found";
    sel.appendChild(opt);
    return;
  }

  monitors.forEach(function (m) {
    var opt = document.createElement("option");
    opt.value = String(m.index);
    opt.textContent = m.index + ": " + (m.description || "Unknown");
    sel.appendChild(opt);
  });

  if (selectedIndex !== undefined && selectedIndex !== null) {
    sel.value = String(selectedIndex);
  }
}
