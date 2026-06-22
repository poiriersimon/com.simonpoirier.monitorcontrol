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
// The monitor catalog is persisted in global settings and only refreshed when
// the user clicks Refresh (or on first use when it does not yet exist).
let $catalog = null;

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
    // request this key's saved settings and the shared monitor catalog
    $ws.send(JSON.stringify({ event: "getSettings", context: $context }));
    $ws.send(JSON.stringify({ event: "getGlobalSettings", context: $uuid }));
    // Safety net: if the global settings response never arrives (e.g. no catalog
    // has ever been saved), build the list anyway so the dropdown is never stuck.
    setTimeout(function () {
      if (!$catalog && !$monitorsLoaded) {
        requestMonitors();
      }
    }, 1200);
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
      renderMonitors();
    }
    if (msg.event === "didReceiveGlobalSettings") {
      handleGlobalSettings((msg.payload && msg.payload.settings) || {});
    }
    if (msg.event === "sendToPropertyInspector") {
      var p = msg.payload || {};
      if (p.event === "monitorList") {
        if (p.monitors && p.monitors.length > 0) {
          $monitorsLoaded = true;
          if ($monitorRetryTimer) { clearTimeout($monitorRetryTimer); $monitorRetryTimer = null; }
          onMonitorList(p.monitors);
        }
      } else {
        onPluginMessage(p);
      }
    }
  };
}

/**
 * Decide how to populate the dropdown from the shared catalog. If a catalog
 * already exists, use it as-is (static). Otherwise build it once (first use).
 */
function handleGlobalSettings(settings) {
  var cat = settings && settings.monitorCatalog;
  if (cat && cat.length > 0) {
    $catalog = cat;
    renderMonitors();
  } else {
    requestMonitors();
  }
}

/** A fresh live monitor list arrived: store it as the catalog and render. */
function onMonitorList(monitors) {
  $catalog = monitors;
  setGlobalSettings({ monitorCatalog: monitors });
  renderMonitors();
}

/** Render the dropdown from the current catalog and saved selection. */
function renderMonitors() {
  if (!$catalog) return;
  populateMonitorDropdown($catalog, typeof _savedSettings !== "undefined" ? _savedSettings : {});
}

/**
 * Request a fresh monitor list, retrying with backoff until it arrives. This is
 * used on first use and whenever the user clicks Refresh. It makes enumeration
 * resilient to cold starts where the plugin process is not yet ready.
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

function setGlobalSettings(obj) {
  if (!$ws || $ws.readyState !== WebSocket.OPEN || !$uuid) return;
  $ws.send(JSON.stringify({
    event: "setGlobalSettings",
    context: $uuid,
    payload: obj
  }));
}

/**
 * Populate the monitor dropdown from a catalog. Each option carries the stable
 * monitor key plus a snapshot of identity fields. Selection is restored by the
 * stable key first so it survives reboots and monitor reordering.
 */
function populateMonitorDropdown(monitors, selectedSettings) {
  var sel = document.getElementById("monitorIndex");
  sel.innerHTML = "";

  if (!monitors || monitors.length === 0) {
    var opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No monitors found";
    sel.appendChild(opt);
    return;
  }

  monitors.forEach(function (m) {
    var opt = document.createElement("option");
    var key = (m.key && String(m.key)) ? String(m.key) : String(m.index);
    opt.value = key;
    var name = (m.model && String(m.model).trim()) ? String(m.model).trim() : (m.description || "Unknown");
    var hw = m.hardwareId ? String(m.hardwareId) : shortHardwareId(m.deviceId);
    opt.textContent = name + (hw ? " [" + hw + "]" : "");
    opt.dataset.key = key;
    opt.dataset.index = String(m.index);
    opt.dataset.description = String(m.description || "");
    opt.dataset.deviceId = String(m.deviceId || "");
    opt.dataset.model = String(m.model || "");
    sel.appendChild(opt);
  });

  var s = selectedSettings || {};
  var selectedKey = (s.monitorKey !== undefined && s.monitorKey !== null) ? String(s.monitorKey).trim().toUpperCase() : null;
  var selectedId = (s.monitorId !== undefined && s.monitorId !== null) ? String(s.monitorId).trim() : null;
  var selectedDescription = (s.monitorDescription !== undefined && s.monitorDescription !== null) ? String(s.monitorDescription).trim().toLowerCase() : null;
  var selectedIndex = (s.monitorIndex !== undefined && s.monitorIndex !== null) ? Number(s.monitorIndex) : null;

  // 1. Match by stable key (survives reboots and UID reorders).
  if (selectedKey) {
    var byKey = monitors.find(function (m) {
      return String(m.key || "").toUpperCase() === selectedKey;
    });
    if (byKey) {
      sel.value = (byKey.key && String(byKey.key)) ? String(byKey.key) : String(byKey.index);
      return;
    }
  }

  // 2. Match by legacy device id.
  if (selectedId) {
    var byId = monitors.find(function (m) {
      return String(m.deviceId || "").trim() === selectedId;
    });
    if (byId) {
      sel.value = (byId.key && String(byId.key)) ? String(byId.key) : String(byId.index);
      return;
    }
  }

  // 3. Match by description, disambiguated by saved index when duplicated.
  if (selectedDescription) {
    var descMatches = monitors.filter(function (m) {
      return String(m.description || "").trim().toLowerCase() === selectedDescription;
    });
    var chosen = null;
    if (descMatches.length === 1) {
      chosen = descMatches[0];
    } else if (descMatches.length > 1) {
      chosen = descMatches.find(function (m) { return m.index === selectedIndex; }) || descMatches[0];
    }
    if (chosen) {
      sel.value = (chosen.key && String(chosen.key)) ? String(chosen.key) : String(chosen.index);
      return;
    }
  }

  // 4. Fall back to the first option.
  if (sel.options.length > 0) {
    sel.selectedIndex = 0;
  }
}
