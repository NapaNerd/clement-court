/* 46 Clement Court — renovation budget dashboard
 *
 * Reads the published snapshot from the Apps Script endpoint bound to the
 * Google Sheet, caches it in localStorage, and derives every number on
 * render. Nothing derived is ever stored.
 *
 * Scoping rule from the design handoff: phases, priorities and categories
 * cover SCOPE LINE ITEMS ONLY. The per-room repeating extras are deliberately
 * kept separate and must never be folded into phase totals.
 */
(function () {
  'use strict';

  var LS_PASS = 'cc.passcode';
  var LS_SNAP = 'cc.snapshot';
  var LS_CUSHION = 'cc.cushion';

  /* ---------------- display metadata ---------------- */

  var PHASE_META = {
    'Phase 1': { num: 1, name: 'Phase 1', tag: 'permits, systems, shell',  color: '#E8917A' },
    'Phase 2': { num: 2, name: 'Phase 2', tag: 'kitchen, baths, finishes', color: '#7FA8C9' },
    'Phase 3': { num: 3, name: 'Phase 3', tag: 'deck, closets, landscape', color: '#8FB585' },
    'Unassigned': { num: 4, name: 'Unassigned', tag: 'needs a phase in the sheet', color: '#9C8A82' }
  };
  var PHASE_ORDER = ['Phase 1', 'Phase 2', 'Phase 3', 'Unassigned'];

  var PRIORITY_META = {
    'Must Do':      { border: '#F7D9CF', bg: '#FFF6F2' },
    'Should Do':    { border: '#DCE8F2', bg: '#F6FAFD' },
    'Nice To Have': { border: '#DCEBD6', bg: '#F6FBF4' },
    'Deferred':     { border: '#F5EAE1', bg: '#FFF9F3' }
  };
  var PRIORITY_ORDER = ['Must Do', 'Should Do', 'Nice To Have', 'Deferred'];

  var FLOOR_TINT = { 'Main Floor': '#FFE3D2', '1st Floor': '#DCE8F2', 'Exterior': '#DCEBD6', 'All': '#F7E9C6' };
  var FLOOR_BORDER = { 'Main Floor': '#F7E2D3', '1st Floor': '#DCE8F2', 'Exterior': '#DCEBD6', 'All': '#F4E4C2' };

  /* Friendly labels for the repeating-extras tiles, in the order the design
     shows them. Keyed by the Category column of the Per Room Items tab.
     Anything not listed here still renders, appended under its raw name, so a
     new category in the sheet never silently vanishes from the breakdown. */
  var EXTRA_LABELS = [
    ['Paint',                  'Paint'],
    ['Flooring',               'Flooring'],
    ['Interior Doors & Trim',  'Doors & trim'],
    ['Lighting',               'Lighting'],
    ['Window Coverings',       'Window shades'],
    ['Closet & Storage',       'Closet shelving'],
    ['Electrical',             'Electrical bits'],
    ['HVAC',                   'HVAC registers'],
    ['Hardware & Accessories', 'Hardware']
  ];

  /* ---------------- helpers ---------------- */

  function money(n) { return '$' + Math.round(n || 0).toLocaleString('en-US'); }
  function num(n) { var v = parseFloat(n); return isFinite(v) ? v : 0; }
  function pct(part, whole) { return whole ? (part / whole * 100) : 0; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function el(id) { return document.getElementById(id); }
  function show(node, on) { if (node) node.hidden = !on; }

  function ago(iso) {
    var then = Date.parse(iso);
    if (!isFinite(then)) return 'at an unknown time';
    var s = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (s < 45) return 'just now';
    if (s < 90) return 'a minute ago';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' minutes ago';
    var h = Math.round(m / 60);
    if (h < 24) return h === 1 ? 'an hour ago' : h + ' hours ago';
    var d = Math.round(h / 24);
    if (d === 1) return 'yesterday';
    if (d < 30) return d + ' days ago';
    return 'on ' + new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function absTime(iso) {
    var t = Date.parse(iso);
    return isFinite(t) ? new Date(t).toLocaleString('en-US') : '';
  }

  /* ---------------- state ---------------- */

  var state = {
    data: null,
    openRoom: null,
    showCategories: true,
    cushionPct: null,   // null = follow the sheet
    stale: false,
    refreshing: false
  };

  /* ---------------- derivation ---------------- */

  function derive(data) {
    var items = (data.lineItems || []).filter(function (i) { return i.room && i.name; });
    var rooms = (data.rooms || []).filter(function (r) { return r.name; });
    var extraRows = data.extras || [];
    var meta = data.meta || {};

    var sheetPct = num(meta.contingencyPct);
    var cushionPct = state.cushionPct == null ? sheetPct : state.cushionPct;

    var scopeTotal = items.reduce(function (s, i) { return s + num(i.budget); }, 0);
    var extrasTotal = rooms.reduce(function (s, r) { return s + num(r.extras); }, 0);
    var hard = scopeTotal + extrasTotal;
    var cushion = hard * cushionPct / 100;
    var total = hard + cushion;
    var spent = items.reduce(function (s, i) { return s + num(i.actual); }, 0);
    var loggedCount = items.filter(function (i) { return num(i.actual) > 0; }).length;
    var finishedSqft = num(meta.finishedSqft);

    /* group scope items by room */
    var byRoom = {};
    items.forEach(function (i) { (byRoom[i.room] = byRoom[i.room] || []).push(i); });

    var roomCards = rooms.map(function (r) {
      var own = (byRoom[r.name] || []).slice().sort(function (a, b) { return num(b.budget) - num(a.budget); });
      var scope = own.reduce(function (s, i) { return s + num(i.budget); }, 0);
      var extras = num(r.extras);
      var t = scope + extras;
      var actual = own.reduce(function (s, i) { return s + num(i.actual); }, 0);
      return {
        name: r.name,
        sub: num(r.sqft) ? r.floor + ' · ' + num(r.sqft).toLocaleString('en-US') + ' sq ft' : 'project wide',
        total: t,
        scope: scope,
        extras: extras,
        actual: actual,
        scopeW: pct(scope, t),
        extrasW: pct(extras, t),
        tint: FLOOR_TINT[r.floor] || '#F5EAE1',
        border: FLOOR_BORDER[r.floor] || '#F5EAE1',
        items: own
      };
    }).sort(function (a, b) { return b.total - a.total; });

    /* phases — scope items only */
    var phases = PHASE_ORDER.map(function (key) {
      var own = items.filter(function (i) { return (i.phase || 'Unassigned') === key; });
      if (!own.length) return null;
      var sum = own.reduce(function (s, i) { return s + num(i.budget); }, 0);
      var chips = own.slice().sort(function (a, b) { return num(b.budget) - num(a.budget); })
        .map(function (i) { return i.room; });
      var unique = [];
      chips.forEach(function (c) { if (unique.indexOf(c) === -1 && unique.length < 3) unique.push(c); });
      var m = PHASE_META[key] || { num: '?', name: key, tag: '', color: '#9C8A82' };
      return {
        num: m.num, name: m.name, tag: m.tag, color: m.color,
        total: sum, w: pct(sum, scopeTotal),
        share: Math.round(pct(sum, scopeTotal)) + '%',
        count: own.length, chips: unique
      };
    }).filter(Boolean);

    /* priorities — scope items only */
    var priorities = PRIORITY_ORDER.map(function (key) {
      var own = items.filter(function (i) { return i.priority === key; });
      if (!own.length) return null;
      var sum = own.reduce(function (s, i) { return s + num(i.budget); }, 0);
      var m = PRIORITY_META[key];
      return {
        name: key, total: sum, count: own.length,
        share: Math.round(pct(sum, scopeTotal)) + '%',
        border: m.border, bg: m.bg
      };
    }).filter(Boolean);

    /* categories — scope items only, bars normalised to the largest */
    var catMap = {};
    items.forEach(function (i) {
      var k = i.category || 'Other';
      catMap[k] = (catMap[k] || 0) + num(i.budget);
    });
    var maxCat = 0;
    Object.keys(catMap).forEach(function (k) { if (catMap[k] > maxCat) maxCat = catMap[k]; });
    var categories = Object.keys(catMap).map(function (k) {
      return { name: k, total: catMap[k], w: pct(catMap[k], maxCat) };
    }).sort(function (a, b) { return b.total - a.total; });

    /* repeating-extras tiles, grouped by category */
    var extraMap = {};
    extraRows.forEach(function (row) {
      var k = row.category || 'Other';
      extraMap[k] = (extraMap[k] || 0) + num(row.total);
    });
    var tiles = [];
    EXTRA_LABELS.forEach(function (pair) {
      if (extraMap[pair[0]] != null) {
        tiles.push({ label: pair[1], total: extraMap[pair[0]] });
        delete extraMap[pair[0]];
      }
    });
    Object.keys(extraMap).sort(function (a, b) { return extraMap[b] - extraMap[a]; })
      .forEach(function (k) { tiles.push({ label: k, total: extraMap[k] }); });

    /* data-integrity warnings */
    var warnings = (data.warnings || []).slice();
    var known = {};
    rooms.forEach(function (r) { known[r.name] = true; });
    var orphans = [];
    items.forEach(function (i) {
      if (!known[i.room] && orphans.indexOf(i.room) === -1) orphans.push(i.room);
    });
    if (orphans.length) {
      warnings.push('These rooms appear in Line Items but not in the Rooms tab, so their money is not counted in any room box: ' +
        orphans.join(', ') + '.');
    }
    var tileSum = tiles.reduce(function (s, t) { return s + t.total; }, 0);
    if (Math.abs(tileSum - extrasTotal) > 1) {
      warnings.push('The repeating-extras breakdown adds up to ' + money(tileSum) +
        ' but the room subtotals add up to ' + money(extrasTotal) +
        '. Check the Per Room Items tab against the Rooms tab.');
    }

    return {
      items: items, roomCards: roomCards, phases: phases, priorities: priorities,
      categories: categories, tiles: tiles, warnings: warnings,
      scopeTotal: scopeTotal, extrasTotal: extrasTotal, hard: hard,
      cushion: cushion, cushionPct: cushionPct, sheetPct: sheetPct,
      total: total, spent: spent, remaining: total - spent, loggedCount: loggedCount,
      finishedSqft: finishedSqft, roomCount: rooms.length,
      perSqft: finishedSqft ? total / finishedSqft : 0
    };
  }

  /* ---------------- render ---------------- */

  function render() {
    if (!state.data) return;
    var d = derive(state.data);

    /* stamp */
    el('stamp-text').textContent = 'Numbers published ' + ago(state.data.publishedAt);
    el('stamp-text').title = absTime(state.data.publishedAt);

    /* hero */
    el('total').textContent = money(d.total);
    el('hero-line').innerHTML = esc(money(d.hard)) + ' of work &nbsp;+&nbsp; ' +
      esc(money(d.cushion)) + ' cushion (' + d.cushionPct + '%)';
    el('chip-sqft').textContent = d.finishedSqft
      ? money(d.perSqft) + ' per finished sq ft'
      : 'finished sq ft not set in the sheet';
    el('chip-spaces').textContent = (d.finishedSqft ? d.finishedSqft.toLocaleString('en-US') + ' sq ft · ' : '') +
      d.roomCount + ' spaces';

    el('cushion').value = d.cushionPct;
    el('cushion-val').textContent = d.cushionPct + '%';
    show(el('cushion-reset'), state.cushionPct != null && state.cushionPct !== d.sheetPct);

    /* spend tracker */
    el('spent').textContent = money(d.spent);
    el('remaining').textContent = money(d.remaining);
    el('spent-bar').style.width = Math.min(100, pct(d.spent, d.total)).toFixed(1) + '%';
    var note = el('tracker-note');
    if (d.spent > 0) {
      note.textContent = d.loggedCount + (d.loggedCount === 1 ? ' job has' : ' jobs have') +
        ' money logged · ' + Math.round(pct(d.spent, d.total)) + '% of the budget used';
      show(note, true);
    } else {
      note.textContent = 'Nothing logged yet — this fills in as you enter payments in the Actual column.';
      show(note, true);
    }

    /* phases */
    el('phases').innerHTML = d.phases.map(function (p) {
      return '<article class="phase">' +
        '<div class="phase-head">' +
          '<span class="phase-num" style="background:' + esc(p.color) + '">' + esc(p.num) + '</span>' +
          '<span class="phase-names">' +
            '<span class="phase-name">' + esc(p.name) + '</span>' +
            '<span class="phase-tag">' + esc(p.tag) + '</span>' +
          '</span>' +
        '</div>' +
        '<div class="phase-money">' + esc(money(p.total)) + '</div>' +
        '<div class="bar bar-12"><div class="bar-fill" style="width:' + p.w.toFixed(1) + '%;background:' + esc(p.color) + '"></div></div>' +
        '<div class="phase-meta">' + esc(p.share) + ' of scope work · ' + p.count + ' jobs</div>' +
        '<div class="phase-chips">' + p.chips.map(function (c) {
          return '<span class="phase-chip">' + esc(c) + '</span>';
        }).join('') + '</div>' +
      '</article>';
    }).join('');

    /* rooms */
    el('rooms').innerHTML = d.roomCards.map(function (r) {
      var open = state.openRoom === r.name;
      var panel = '';
      if (open) {
        panel = '<div class="room-panel">' +
          r.items.map(function (i) {
            var actual = num(i.actual);
            var variance = num(i.budget) - actual;
            var actualLine = actual > 0
              ? '<span class="item-actual' + (variance < 0 ? ' over' : '') + '">paid ' + esc(money(actual)) +
                ' · ' + esc(money(Math.abs(variance))) + (variance < 0 ? ' over' : ' under') + '</span>'
              : '';
            return '<div class="item">' +
              '<div class="item-top"><span>' + esc(i.name) + '</span>' +
                '<span class="item-money">' + esc(money(i.budget)) + '</span></div>' +
              '<div class="item-tags">' +
                '<span>' + esc(i.category || 'Other') + '</span>' +
                '<span>' + esc(i.phase || 'Unassigned') + '</span>' +
                '<span>' + esc(i.priority || '—') + '</span>' +
              '</div>' + actualLine +
            '</div>';
          }).join('') +
          '<div class="panel-foot">+ ' + esc(money(r.extras)) +
            ' of repeating extras (paint, floors, trim, lights)</div>' +
        '</div>';
      }
      return '<button type="button" class="room" data-room="' + esc(r.name) + '" aria-expanded="' + open + '"' +
          ' style="border-color:' + esc(r.border) + '">' +
        '<span class="room-top">' +
          '<span class="room-names">' +
            '<span class="room-name">' + esc(r.name) + '</span>' +
            '<span class="room-sub">' + esc(r.sub) + '</span>' +
          '</span>' +
          '<span class="room-badge" style="background:' + esc(r.tint) + '" aria-hidden="true">' +
            (open ? '–' : '+') + '</span>' +
        '</span>' +
        '<span class="room-money">' + esc(money(r.total)) + '</span>' +
        '<span class="room-split">' +
          '<div class="split-scope" style="width:' + r.scopeW.toFixed(1) + '%"></div>' +
          '<div class="split-extras" style="width:' + r.extrasW.toFixed(1) + '%"></div>' +
        '</span>' +
        '<span class="room-legend">' +
          '<span>big jobs ' + esc(money(r.scope)) + '</span>' +
          '<span>extras ' + esc(money(r.extras)) + '</span>' +
        '</span>' +
        (r.actual > 0 ? '<span class="room-legend"><span>paid so far</span><span>' + esc(money(r.actual)) + '</span></span>' : '') +
        panel +
      '</button>';
    }).join('');

    /* repeating extras */
    el('extras-total').textContent = money(d.extrasTotal);
    el('extras-tiles').innerHTML = d.tiles.map(function (t) {
      return '<div class="tile"><span class="tile-label">' + esc(t.label) + '</span>' +
        '<span class="tile-val">' + esc(money(t.total)) + '</span></div>';
    }).join('');

    /* categories */
    el('cat-card').innerHTML = d.categories.map(function (c) {
      return '<div class="cat">' +
        '<div class="cat-top"><span>' + esc(c.name) + '</span>' +
          '<span class="cat-val">' + esc(money(c.total)) + '</span></div>' +
        '<div class="bar bar-10"><div class="bar-fill bar-terra" style="width:' + c.w.toFixed(1) + '%"></div></div>' +
      '</div>';
    }).join('');
    show(el('cat-card'), state.showCategories);
    el('cat-toggle').textContent = state.showCategories ? 'hide' : 'show';
    el('cat-toggle').setAttribute('aria-expanded', String(state.showCategories));

    /* priorities */
    el('priorities').innerHTML = d.priorities.map(function (p) {
      return '<article class="prio" style="border-color:' + esc(p.border) + ';background:' + esc(p.bg) + '">' +
        '<span class="prio-label">' + esc(p.name) + '</span>' +
        '<span class="prio-money">' + esc(money(p.total)) + '</span>' +
        '<span class="prio-meta">' + p.count + ' jobs · ' + esc(p.share) + ' of scope</span>' +
      '</article>';
    }).join('');

    /* warnings */
    if (d.warnings.length) {
      el('warn-list').innerHTML = d.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('');
      show(el('warn'), true);
    } else {
      show(el('warn'), false);
    }

    /* footnote */
    el('foot-body').textContent = 'Every dollar here is a placeholder estimate for a Napa remodel, not a quote. ' +
      'Room sizes are max-rectangle takeoffs from the floor plan, so they add up higher than the ' +
      (d.finishedSqft ? d.finishedSqft.toLocaleString('en-US') : 'finished') +
      ' sq ft finished number. Whole House holds the project-wide costs that don\'t belong to one room. ' +
      'Cushion is set to ' + d.cushionPct + '% — ten to fifteen percent is normal for a remodel this size.';

    show(el('app'), true);
    show(el('loading'), false);
    show(el('fatal'), false);
    show(el('gate'), false);
    renderBanner();
  }

  function renderBanner() {
    var b = el('banner');
    if (!state.stale || !state.data) { show(b, false); return; }
    el('banner-text').textContent = "Couldn't reach the spreadsheet just now — showing the numbers saved " +
      ago(state.data.publishedAt) + '.';
    show(b, true);
  }

  /* ---------------- data layer ---------------- */

  function savedPass() { try { return localStorage.getItem(LS_PASS); } catch (e) { return null; } }
  function savePass(p) { try { localStorage.setItem(LS_PASS, p); } catch (e) {} }
  function clearPass() { try { localStorage.removeItem(LS_PASS); localStorage.removeItem(LS_SNAP); } catch (e) {} }
  function savedSnap() {
    try { var raw = localStorage.getItem(LS_SNAP); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function saveSnap(d) { try { localStorage.setItem(LS_SNAP, JSON.stringify(d)); } catch (e) {} }

  function fetchSnapshot(pass) {
    if (!window.CC_CONFIG || !window.CC_CONFIG.endpoint) {
      return Promise.reject({ kind: 'unconfigured' });
    }
    /* Plain GET with no custom headers so the browser treats it as a simple
       request — Apps Script cannot answer a CORS preflight. */
    var url = window.CC_CONFIG.endpoint +
      (window.CC_CONFIG.endpoint.indexOf('?') === -1 ? '?' : '&') +
      'k=' + encodeURIComponent(pass) + '&t=' + Date.now();
    return fetch(url, { method: 'GET', redirect: 'follow', cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw { kind: 'network', status: res.status };
        return res.json();
      })
      .then(function (body) {
        if (!body || body.ok !== true) {
          throw { kind: body && body.error === 'unauthorized' ? 'unauthorized' : 'server',
                  message: body && body.message };
        }
        return body;
      })
      .catch(function (err) {
        if (err && err.kind) throw err;
        throw { kind: 'network', message: err && err.message };
      });
  }

  function refresh(background) {
    var pass = savedPass();
    if (!pass) { showGate(); return Promise.resolve(); }
    if (state.refreshing) return Promise.resolve();
    state.refreshing = true;
    setRefreshing(true);

    return fetchSnapshot(pass).then(function (body) {
      state.refreshing = false;
      setRefreshing(false);
      state.stale = false;
      var isNew = !state.data || state.data.publishedAt !== body.publishedAt;
      state.data = body;
      saveSnap(body);
      render();
      if (isNew && background) flashStamp();
    }).catch(function (err) {
      state.refreshing = false;
      setRefreshing(false);
      if (err.kind === 'unauthorized') {
        clearPass();
        state.data = null;
        showGate('That passcode did not work. Give it another go.');
        return;
      }
      if (state.data) {
        state.stale = true;
        renderBanner();
        return;
      }
      showFatal(err);
    });
  }

  function setRefreshing(on) {
    var btn = el('stamp-refresh');
    if (!btn) return;
    btn.textContent = on ? 'checking…' : 'Refresh';
    btn.disabled = on;
    btn.classList.toggle('spinning', on);
  }

  function flashStamp() {
    var t = el('stamp-text');
    t.textContent = 'Just updated — ' + t.textContent.toLowerCase();
  }

  /* ---------------- screens ---------------- */

  function showGate(message) {
    show(el('gate'), true);
    show(el('app'), false);
    show(el('loading'), false);
    show(el('fatal'), false);
    var err = el('gate-err');
    if (message) { err.textContent = message; show(err, true); } else { show(err, false); }
    el('gate-input').value = '';
    el('gate-btn').disabled = false;
    el('gate-btn').textContent = 'Show me the money';
    setTimeout(function () { el('gate-input').focus(); }, 30);
  }

  function showLoading() {
    show(el('loading'), true);
    show(el('gate'), false);
    show(el('app'), false);
    show(el('fatal'), false);
  }

  function showFatal(err) {
    var msg;
    if (err && err.kind === 'unconfigured') {
      msg = 'This dashboard has not been connected to the spreadsheet yet. ' +
            'The web app URL still needs to go into assets/config.js.';
    } else {
      msg = "We can't load the numbers right now, and there's no saved copy on this device yet. " +
            'Check the connection and try again.';
    }
    el('fatal-body').textContent = msg;
    show(el('fatal'), true);
    show(el('loading'), false);
    show(el('gate'), false);
    show(el('app'), false);
  }

  /* ---------------- events ---------------- */

  el('gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var code = el('gate-input').value.trim();
    if (!code) return;
    var btn = el('gate-btn');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    show(el('gate-err'), false);

    fetchSnapshot(code).then(function (body) {
      savePass(code);
      state.data = body;
      state.stale = false;
      saveSnap(body);
      render();
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = 'Show me the money';
      var e2 = el('gate-err');
      if (err.kind === 'unauthorized') {
        e2.textContent = 'That passcode did not work. Give it another go.';
      } else if (err.kind === 'unconfigured') {
        e2.textContent = 'Not connected to the spreadsheet yet — config.js needs the web app URL.';
      } else if (err.kind === 'server') {
        e2.textContent = err.message || 'The spreadsheet answered, but something was off. Try publishing again.';
      } else {
        e2.textContent = "Couldn't reach the spreadsheet. Check your connection and try again.";
      }
      show(e2, true);
    });
  });

  el('rooms').addEventListener('click', function (e) {
    var card = e.target.closest('.room');
    if (!card) return;
    var name = card.getAttribute('data-room');
    state.openRoom = state.openRoom === name ? null : name;
    render();
    var again = document.querySelector('.room[data-room="' + (window.CSS && CSS.escape ? CSS.escape(name) : name) + '"]');
    if (again) again.focus({ preventScroll: true });
  });

  el('cushion').addEventListener('input', function (e) {
    state.cushionPct = parseInt(e.target.value, 10);
    try { localStorage.setItem(LS_CUSHION, state.cushionPct); } catch (err) {}
    render();
  });

  el('cushion-reset').addEventListener('click', function () {
    state.cushionPct = null;
    try { localStorage.removeItem(LS_CUSHION); } catch (err) {}
    render();
  });

  el('cat-toggle').addEventListener('click', function () {
    state.showCategories = !state.showCategories;
    render();
  });

  el('stamp-refresh').addEventListener('click', function () { refresh(true); });
  el('banner-retry').addEventListener('click', function () { refresh(true); });
  el('fatal-retry').addEventListener('click', function () {
    if (savedPass()) { showLoading(); refresh(false); } else { showGate(); }
  });
  el('fatal-forget').addEventListener('click', function () { clearPass(); showGate(); });
  el('sign-out').addEventListener('click', function () {
    clearPass();
    state.data = null;
    showGate();
  });

  /* Coming back to the tab after a while? Quietly check for new numbers. */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && state.data) refresh(true);
  });

  /* ---------------- boot ---------------- */

  try {
    var savedCushion = localStorage.getItem(LS_CUSHION);
    if (savedCushion != null && savedCushion !== '') state.cushionPct = parseInt(savedCushion, 10);
  } catch (e) {}

  if (!savedPass()) {
    showGate();
  } else {
    var snap = savedSnap();
    if (snap) {
      state.data = snap;
      render();          // instant paint from cache
      refresh(true);     // then quietly catch up
    } else {
      showLoading();
      refresh(false);
    }
  }
})();
