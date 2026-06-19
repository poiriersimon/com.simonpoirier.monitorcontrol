/**
 * Shared PI ↔ plugin communication helpers.
 * Loaded by both set-input.html and toggle-input.html.
 */

/* globals */
let $ws = null;
let $uuid = null;
let $context = null;
let $action = null;
let $actionInfo = null;
let $monitorsLoaded = false;
let $monitorRetries = 0;
let $monitorRetryTimer = null;

/**
 * Called by Stream Deck to initialise the PI WebSocket.
 */
function connectElgatoStreamDeckSocket(inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) {
  $uuid = inUUID;
  try {
    $actionInfo = JSON.parse(inActionInfo);
  } catch (e) {
    $actionInfo = {};
  }
  // For the property inspector, inUUID IS the action instance context used for
  // all PI <-> plugin messaging (getSettings, setSettings, sendToPlugin).
  $context = inUUID;
  $action = ($actionInfo && $actionInfo.action) ? $actionInfo.action : null;

  $ws = new WebSocket("ws://127.0.0.1:" + inPort);

  $ws.onopen = function () {
    $ws.send(JSON.stringify({ event: inRegisterEvent, uuid: $uuid }));
    // request saved settings
    $ws.send(JSON.stringify({ event: "getSettings", context: $context }));
    // ask plugin to enumerate monitors (with retry: the plugin process may not
    // be fully connected yet on a cold start, which would drop the first request)
    requestMonitors();
  };

  $ws.onmessage = function (evt) {
    var msg;
    try {
      msg = JSON.parse(evt.data);
    } catch (e) {
      return;
    }
    if (msg.event === "didReceiveSettings") {
      onSettingsReceived((msg.payload && msg.payload.settings) || {});
    }
    if (msg.event === "sendToPropertyInspector") {
      var p = msg.payload || {};
      if (p.event === "monitorList" && p.monitors && p.monitors.length > 0) {
        $monitorsLoaded = true;
        if ($monitorRetryTimer) { clearTimeout($monitorRetryTimer); $monitorRetryTimer = null; }
      }
      onPluginMessage(p);
    }
  };
}

/**
 * Request the monitor list, retrying with backoff until it arrives. This makes
 * the dropdown resilient to cold starts where the plugin process is not yet
 * ready when the property inspector first connects.
 */
function requestMonitors() {
  $monitorsLoaded = false;
  $monitorRetries = 0;
  if ($monitorRetryTimer) { clearTimeout($monitorRetryTimer); $monitorRetryTimer = null; }
  tryRequestMonitors();
}

function tryRequestMonitors() {
  if ($monitorsLoaded) return;
  sendToPlugin({ event: "getMonitors" });
  $monitorRetries++;
  if ($monitorRetries < 12) {
    $monitorRetryTimer = setTimeout(tryRequestMonitors, 800);
  }
}

/**
 * Extract a short, unique hardware id from a device interface path so the user
 * can distinguish monitors that share the same generic description.
 * Example: "\\?\DISPLAY#DELD107#3&...#{guid}" -> "DELD107"
 */
function shortHardwareId(deviceId) {
  if (!deviceId) return "";
  var parts = String(deviceId).split("#");
  return parts.length >= 2 ? parts[1] : "";
}

function sendToPlugin(payload) {
  if (!$ws || $ws.readyState !== WebSocket.OPEN || !$context) {
    return;
  }
  $ws.send(JSON.stringify({
    event: "sendToPlugin",
    action: $action,
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
 * @param {object|undefined} selectedSettings - saved settings with monitorIndex and monitorDescription
 */
function populateMonitorDropdown(monitors, selectedSettings) {
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
    var name = (m.model && String(m.model).trim()) ? String(m.model).trim() : (m.description || "Unknown");
    var hw = shortHardwareId(m.deviceId);
    opt.textContent = m.index + ": " + name + (hw ? " [" + hw + "]" : "");
    opt.dataset.description = String(m.description || "");
    opt.dataset.deviceId = String(m.deviceId || "");
    sel.appendChild(opt);
  });

  var selectedIndex = null;
  var selectedDescription = null;
  var selectedId = null;

  if (selectedSettings) {
    if (selectedSettings.monitorId !== undefined && selectedSettings.monitorId !== null) {
      selectedId = String(selectedSettings.monitorId).trim();
    }
    if (selectedSettings.monitorDescription !== undefined && selectedSettings.monitorDescription !== null) {
      selectedDescription = String(selectedSettings.monitorDescription).trim().toLowerCase();
    }
    if (selectedSettings.monitorIndex !== undefined && selectedSettings.monitorIndex !== null) {
      selectedIndex = Number(selectedSettings.monitorIndex);
    }
  }

  // 1. Match by unique device id (most reliable across reboots/reorders).
  if (selectedId) {
    var byId = monitors.find(function (m) {
      return String(m.deviceId || "").trim() === selectedId;
    });
    if (byId) {
      sel.value = String(byId.index);
      return;
    }
  }

  // 2. Match by description, disambiguated by saved index when duplicated.
  if (selectedDescription) {
    var descMatches = monitors.filter(function (m) {
      return String(m.description || "").trim().toLowerCase() === selectedDescription;
    });
    if (descMatches.length === 1) {
      sel.value = String(descMatches[0].index);
      return;
    }
    if (descMatches.length > 1) {
      var dup = descMatches.find(function (m) { return m.index === selectedIndex; });
      sel.value = String((dup || descMatches[0]).index);
      return;
    }
  }

  // 3. Fall back to saved index.
  if (selectedIndex !== null && !Number.isNaN(selectedIndex)) {
    sel.value = String(selectedIndex);
  }
}
