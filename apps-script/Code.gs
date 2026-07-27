/**
 * 46 Clement Court — renovation budget dashboard publisher
 *
 * Lives inside the Google Sheet (Extensions -> Apps Script). Two jobs:
 *
 *   1. A "Renovation dashboard" menu with a Publish button. Publishing reads
 *      the raw entry tabs, builds a JSON snapshot, and parks it on a hidden
 *      sheet. Nothing else in the workbook is touched.
 *
 *   2. doGet — a web app endpoint that hands that snapshot to the dashboard,
 *      but only when the request carries the right passcode.
 *
 * The dashboard always sees the last PUBLISHED snapshot, never your live
 * cells, so you can edit freely and decide when the numbers go out.
 *
 * Setup lives in ../README.md.
 */

var SNAPSHOT_SHEET = '_dashboard_published';
var PROP_PASSCODE = 'DASHBOARD_PASSCODE';
var CHUNK_SIZE = 40000;          // cell limit is 50k chars; leave headroom
var HEADER_SCAN_ROWS = 10;       // how far down to hunt for the header row

/* =========================================================================
 * Menu
 * ========================================================================= */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Renovation dashboard')
    .addItem('Publish to dashboard', 'publish')
    .addSeparator()
    .addItem('Set dashboard passcode', 'setPasscode')
    .addItem('Show dashboard details', 'showDetails')
    .addItem('Preview what would publish', 'previewSnapshot')
    .addToUi();
}

function publish() {
  var ui = SpreadsheetApp.getUi();
  var result;
  try {
    result = buildSnapshot();
  } catch (err) {
    ui.alert('Could not publish', String(err && err.message || err), ui.ButtonSet.OK);
    return;
  }

  writeSnapshot(result.payload);

  var msg = 'Published ' + result.payload.lineItems.length + ' scope items and ' +
            result.payload.rooms.length + ' rooms.\n\n' +
            'Total project budget: ' + fmtMoney(result.total) + '\n' +
            'Hard cost: ' + fmtMoney(result.hard) + '\n\n' +
            'Reload the dashboard and the new numbers are there.';
  if (result.payload.warnings.length) {
    msg += '\n\nHeads up:\n· ' + result.payload.warnings.join('\n· ');
  }
  ui.alert('Published', msg, ui.ButtonSet.OK);
}

function setPasscode() {
  var ui = SpreadsheetApp.getUi();
  var current = PropertiesService.getScriptProperties().getProperty(PROP_PASSCODE);
  var res = ui.prompt(
    'Dashboard passcode',
    current
      ? 'A passcode is already set. Type a new one to replace it, or Cancel to keep it.'
      : 'Pick the passcode you and Joe will type to open the dashboard.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var code = res.getResponseText().trim();
  if (code.length < 4) {
    ui.alert('Passcode not saved', 'Use at least 4 characters.', ui.ButtonSet.OK);
    return;
  }
  PropertiesService.getScriptProperties().setProperty(PROP_PASSCODE, code);
  ui.alert('Passcode saved',
    'Anyone opening the dashboard will need to type: ' + code +
    '\n\nThey only type it once per device.', ui.ButtonSet.OK);
}

function showDetails() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var sheet = SpreadsheetApp.getActive().getSheetByName(SNAPSHOT_SHEET);
  var when = sheet ? sheet.getRange('A1').getValue() : '';
  ui.alert('Dashboard details',
    'Passcode set: ' + (props.getProperty(PROP_PASSCODE) ? 'yes' : 'NO — set one first') + '\n' +
    'Last published: ' + (when ? when : 'never') + '\n\n' +
    'Web app URL: Deploy -> Manage deployments in the Apps Script editor.\n' +
    'That URL goes into assets/config.js in the clement-court repo.',
    ui.ButtonSet.OK);
}

function previewSnapshot() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = buildSnapshot();
    ui.alert('Would publish',
      'Scope items: ' + r.payload.lineItems.length + '\n' +
      'Rooms: ' + r.payload.rooms.length + '\n' +
      'Repeating extra rows: ' + r.payload.extras.length + '\n\n' +
      'Scope total: ' + fmtMoney(r.scopeTotal) + '\n' +
      'Repeating extras: ' + fmtMoney(r.extrasTotal) + '\n' +
      'Hard cost: ' + fmtMoney(r.hard) + '\n' +
      'Cushion (' + r.payload.meta.contingencyPct + '%): ' + fmtMoney(r.cushion) + '\n' +
      'Total: ' + fmtMoney(r.total) + '\n\n' +
      (r.payload.warnings.length ? 'Warnings:\n· ' + r.payload.warnings.join('\n· ') : 'No warnings.'),
      ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('Could not build snapshot', String(err && err.message || err), ui.ButtonSet.OK);
  }
}

/* =========================================================================
 * Web app endpoint
 * ========================================================================= */

function doGet(e) {
  var expected = PropertiesService.getScriptProperties().getProperty(PROP_PASSCODE);
  var given = (e && e.parameter && e.parameter.k) || '';

  if (!expected) {
    return json({ ok: false, error: 'server',
      message: 'No passcode has been set in the spreadsheet yet.' });
  }
  if (given !== expected) {
    return json({ ok: false, error: 'unauthorized' });
  }

  var stored = readSnapshot();
  if (!stored) {
    return json({ ok: false, error: 'server',
      message: 'Nothing has been published yet. Use Renovation dashboard -> Publish to dashboard.' });
  }
  return ContentService.createTextOutput(stored)
    .setMimeType(ContentService.MimeType.JSON);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* =========================================================================
 * Snapshot storage (hidden sheet, chunked so it can't outgrow a cell)
 * ========================================================================= */

function writeSnapshot(payload) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(SNAPSHOT_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SNAPSHOT_SHEET);
    sheet.getRange('B1').setValue(
      'Generated by the Renovation dashboard menu. Do not edit by hand.');
  }
  sheet.clearContents();

  var text = JSON.stringify(payload);
  var chunks = [];
  for (var i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push([text.substring(i, i + CHUNK_SIZE)]);
  }

  sheet.getRange('A1').setValue(payload.publishedAt);
  sheet.getRange('A2').setValue(chunks.length);
  if (chunks.length) sheet.getRange(3, 1, chunks.length, 1).setValues(chunks);
  sheet.getRange('B1').setValue(
    'Generated by the Renovation dashboard menu. Do not edit by hand.');
  sheet.hideSheet();
  SpreadsheetApp.flush();
}

function readSnapshot() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SNAPSHOT_SHEET);
  if (!sheet) return null;
  var count = Number(sheet.getRange('A2').getValue());
  if (!count || count < 1) return null;
  var rows = sheet.getRange(3, 1, count, 1).getValues();
  var out = '';
  for (var i = 0; i < rows.length; i++) out += rows[i][0];
  return out || null;
}

/* =========================================================================
 * Reading the workbook
 * ========================================================================= */

/**
 * Find the header row by looking for the required column names rather than
 * trusting a fixed row number, then return rows as objects keyed by header.
 */
function readTab(tabName, requiredHeaders) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(tabName);
  if (!sheet) throw new Error('Tab "' + tabName + '" is missing. Rename it back or update the script.');

  var values = sheet.getDataRange().getValues();
  var headerRow = -1;
  var scan = Math.min(HEADER_SCAN_ROWS, values.length);
  for (var r = 0; r < scan; r++) {
    var row = values[r].map(normHeader);
    var hasAll = requiredHeaders.every(function (h) { return row.indexOf(normHeader(h)) !== -1; });
    if (hasAll) { headerRow = r; break; }
  }
  if (headerRow === -1) {
    throw new Error('Could not find the header row on "' + tabName + '". Expected columns: ' +
      requiredHeaders.join(', ') + '.');
  }

  var headers = values[headerRow].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = headerRow + 1; i < values.length; i++) {
    var obj = { __row: i + 1 };
    for (var c = 0; c < headers.length; c++) {
      if (headers[c]) obj[headers[c]] = values[i][c];
    }
    rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

function normHeader(h) {
  return String(h == null ? '' : h).trim().toLowerCase().replace(/\s+/g, ' ');
}

function pick(obj, names) {
  for (var i = 0; i < names.length; i++) {
    for (var key in obj) {
      if (normHeader(key) === normHeader(names[i])) return obj[key];
    }
  }
  return '';
}

function toNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var s = String(v == null ? '' : v).replace(/[$,\s%]/g, '');
  var n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function str(v) { return String(v == null ? '' : v).trim(); }

/** Look up a labelled value on the Dashboard tab: label in one column, value in the next. */
function dashValue(labels) {
  var sheet = SpreadsheetApp.getActive().getSheetByName('Dashboard');
  if (!sheet) return null;
  var values = sheet.getRange(1, 1, Math.min(60, sheet.getLastRow()), Math.min(6, sheet.getLastColumn())).getValues();
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length - 1; c++) {
      var cell = normHeader(values[r][c]);
      for (var i = 0; i < labels.length; i++) {
        if (cell === normHeader(labels[i])) return values[r][c + 1];
      }
    }
  }
  return null;
}

/* =========================================================================
 * Building the snapshot
 * ========================================================================= */

function buildSnapshot() {
  var warnings = [];

  /* ---- Rooms ---- */
  var roomsTab = readTab('Rooms', ['Room', 'Floor']);
  var rooms = [];
  var hitRoomsTotal = false;
  roomsTab.rows.forEach(function (row) {
    if (hitRoomsTotal) return;       // everything past the totals row is notes
    var name = str(pick(row, ['Room']));
    var floor = str(pick(row, ['Floor']));
    if (normHeader(name) === 'total' || normHeader(name) === 'totals') { hitRoomsTotal = true; return; }
    /* A real room always names a floor. This is what keeps the explanatory
       note rows under the table from being counted as rooms. */
    if (!name || !floor) return;
    rooms.push({
      name: name,
      floor: floor,
      sqft: toNum(pick(row, ['Sq Ft', 'SqFt', 'Square Feet'])),
      extras: 0                      // filled in from Per Room Items below
    });
  });
  if (!rooms.length) throw new Error('No rooms found on the Rooms tab.');

  /* ---- Line Items ---- */
  var liTab = readTab('Line Items', ['Room', 'Scope Item']);
  var lineItems = [];
  liTab.rows.forEach(function (row) {
    var room = str(pick(row, ['Room']));
    var name = str(pick(row, ['Scope Item', 'Item', 'Description']));
    if (!room || !name) return;      // skips the ~200 trailing blank rows
    if (normHeader(room) === 'total' || normHeader(room) === 'totals') return;

    var qty = toNum(pick(row, ['Qty', 'Quantity']));
    var unitCost = toNum(pick(row, ['Unit Cost', 'UnitCost', 'Cost']));
    var stated = toNum(pick(row, ['Budget']));
    /* Prefer qty x unit cost so edits to either flow through, but fall back to
       a stated Budget when the row does not use qty pricing. */
    var computed = qty * unitCost;
    var budget = computed > 0 ? computed : stated;
    if (computed > 0 && stated > 0 && Math.abs(computed - stated) > 1) {
      warnings.push('Row ' + row.__row + ' of Line Items ("' + name + '"): Qty x Unit Cost is ' +
        fmtMoney(computed) + ' but the Budget column says ' + fmtMoney(stated) +
        '. The dashboard is using ' + fmtMoney(computed) + '.');
    }

    lineItems.push({
      room: room,
      category: str(pick(row, ['Category'])) || 'Other',
      name: name,
      qty: qty,
      unit: str(pick(row, ['Unit'])),
      unitCost: unitCost,
      budget: budget,
      actual: toNum(pick(row, ['Actual'])),
      priority: str(pick(row, ['Priority'])) || 'Must Do',
      phase: str(pick(row, ['Phase'])) || 'Unassigned',
      status: str(pick(row, ['Status'])),
      vendor: str(pick(row, ['Vendor']))
    });
  });
  if (!lineItems.length) throw new Error('No scope line items found on the Line Items tab.');

  /* ---- Per Room Items ---- */
  var priTab = readTab('Per Room Items', ['Item', 'Unit Cost']);
  var roomIndex = {};
  rooms.forEach(function (r, i) { roomIndex[normHeader(r.name)] = i; });

  /* Match room columns by header NAME, never by position. */
  var roomCols = [];
  var unknownCols = [];
  var NON_ROOM = ['item', 'category', 'unit', 'unit cost', 'total qty', 'total cost', 'notes'];
  priTab.headers.forEach(function (h) {
    var key = normHeader(h);
    if (!key || NON_ROOM.indexOf(key) !== -1) return;
    if (roomIndex[key] != null) roomCols.push({ header: h, roomIdx: roomIndex[key] });
    else unknownCols.push(h);
  });
  if (unknownCols.length) {
    warnings.push('These Per Room Items columns do not match any room on the Rooms tab, so their ' +
      'quantities are ignored: ' + unknownCols.join(', ') + '.');
  }
  rooms.forEach(function (r) {
    var found = roomCols.some(function (rc) { return rc.roomIdx === roomIndex[normHeader(r.name)]; });
    if (!found) {
      warnings.push('"' + r.name + '" has no column on the Per Room Items tab, so it shows ' +
        'no repeating extras.');
    }
  });

  var extras = [];
  priTab.rows.forEach(function (row) {
    var item = str(pick(row, ['Item']));
    if (!item) return;
    var lower = normHeader(item);
    if (lower.indexOf('subtotal') !== -1 || lower === 'total' || lower === 'totals') return;

    var unitCost = toNum(pick(row, ['Unit Cost']));
    var rowTotal = 0;
    roomCols.forEach(function (rc) {
      var qty = toNum(row[rc.header]);
      if (!qty) return;
      var cost = qty * unitCost;
      rowTotal += cost;
      rooms[rc.roomIdx].extras += cost;
    });

    extras.push({
      item: item,
      category: str(pick(row, ['Category'])) || 'Other',
      unit: str(pick(row, ['Unit'])),
      unitCost: unitCost,
      total: rowTotal
    });
  });

  /* ---- Dashboard inputs ---- */
  var rawPct = dashValue(['Contingency percent', 'Contingency %', 'Contingency pct']);
  var contingencyPct = toNum(rawPct);
  /* The cell is formatted as a percent, so it arrives as 0.1 not 10. */
  if (contingencyPct > 0 && contingencyPct <= 1) contingencyPct = contingencyPct * 100;
  if (!contingencyPct) contingencyPct = 10;
  contingencyPct = Math.round(contingencyPct);

  var finishedSqft = toNum(dashValue(['Finished sq ft per plan', 'Finished sq ft', 'Finished square feet']));
  if (!finishedSqft) {
    warnings.push('Could not read "Finished sq ft per plan" from the Dashboard tab, so the ' +
      'per-square-foot number is hidden.');
  }

  var unmatched = toNum(dashValue(['Check: rows not matched to a room']));
  if (unmatched) {
    warnings.push('The Dashboard tab check cell says ' + unmatched + ' Line Items row(s) do not ' +
      'match a room on the Rooms tab. Fix the Room spelling so nothing goes missing.');
  }

  /* ---- Totals, for the confirmation dialog only ---- */
  var scopeTotal = lineItems.reduce(function (s, i) { return s + i.budget; }, 0);
  var extrasTotal = rooms.reduce(function (s, r) { return s + r.extras; }, 0);
  var hard = scopeTotal + extrasTotal;
  var cushion = hard * contingencyPct / 100;

  var payload = {
    ok: true,
    publishedAt: new Date().toISOString(),
    meta: {
      contingencyPct: contingencyPct,
      finishedSqft: finishedSqft,
      property: '46 Clement Court',
      spreadsheetName: SpreadsheetApp.getActive().getName()
    },
    rooms: rooms,
    lineItems: lineItems,
    extras: extras,
    warnings: warnings
  };

  return {
    payload: payload,
    scopeTotal: scopeTotal, extrasTotal: extrasTotal,
    hard: hard, cushion: cushion, total: hard + cushion
  };
}

function fmtMoney(n) {
  return '$' + Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
