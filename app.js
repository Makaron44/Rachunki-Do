/* Przypominacz rachunków – stabilna wersja z motywem Pastel Dark */
(function () {
  // ------- Małe pomocnicze selektory -------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var DB_KEY = 'billreminder.v1';
  var state = loadState();
  var deferredPrompt = null;

  // ------- Elementy interfejsu -------
  var els = {
    viewContainer: $('#view-container'),
    views: $all('.view'),
    tabs: $all('.tabbar .tab'),
    listView: $('#view-list'),
    list: $('#bill-list'),
    statsStrip: $('#stats-strip'),
    statDue: $('#stat-due'),
    statPaid: $('#stat-paid'),
    statLeft: $('#stat-left'),
    empty: $('#empty-state'),
    filterMonth: $('#filter-month'),
    btnAdd: $('#btn-add'),
    btnSample: $('#btn-sample'),
    formView: $('#view-form'),
    form: $('#bill-form'),
    id: $('#bill-id'),
    name: $('#bill-name'),
    amount: $('#bill-amount'),
    due: $('#bill-due'),
    frequency: $('#bill-frequency'),
    interval: $('#bill-interval'),
    labelInterval: $('#label-custom-interval'),
    reminder: $('#bill-reminder'),
    notes: $('#bill-notes'),
    btnCancel: $('#btn-cancel'),
    settingsView: $('#view-settings'),
    settingCurrency: $('#setting-currency'),
    settingDefaultReminder: $('#setting-default-reminder'),
    settingTheme: $('#setting-theme'), // select motywu (jeśli jest w HTML)
    btnExportJson: $('#btn-export-json'),
    inputImportJson: $('#input-import-json'),
    btnUpdateApp: $('#btn-update-app'),
    btnExportCsv: $('#btn-export-csv'),
    btnNotifyPerm: $('#btn-notify-permission'),
    btnTestNotify: $('#btn-test-notify'),
    btnInstall: $('#btn-install'),
    tplItem: $('#tpl-bill-item')
  };

  // ------- Start -------
  registerSW();
  setupInstallPrompt();
  buildMonthFilter();
  bindEvents();
  render();

  // ======= Funkcje stanu i utils =======
  function loadState() {
    var def = {
      version: 1,
      settings: { currency: 'PLN', defaultReminderDays: 3, theme: 'default' },
      bills: []
    };
    try {
      var raw = localStorage.getItem(DB_KEY);
      if (!raw) return def;
      var parsed = JSON.parse(raw);

      // MIGRACJE:
      // 1) brak ID na niektórych rachunkach → nadaj
      if (parsed && Array.isArray(parsed.bills)) {
        for (var i = 0; i < parsed.bills.length; i++) {
          if (!parsed.bills[i].id) parsed.bills[i].id = uid();
        }
      }
      if (!parsed.settings) parsed.settings = {};
      if (!parsed.settings.currency) parsed.settings.currency = 'PLN';
      if (typeof parsed.settings.defaultReminderDays !== 'number') parsed.settings.defaultReminderDays = 3;
      if (!parsed.settings.theme) parsed.settings.theme = 'default';

      return merge(def, parsed);
    } catch (e) {
      console.warn('Błąd odczytu danych, reset.', e);
      return def;
    }
  }

  function saveState() {
    localStorage.setItem(DB_KEY, JSON.stringify(state));
    render(); // re-render po zapisie
  }

  function merge(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    for (var k2 in b) {
      if (typeof b[k2] === 'object' && b[k2] && !Array.isArray(b[k2])) out[k2] = merge(out[k2] || {}, b[k2]);
      else out[k2] = b[k2];
    }
    return out;
  }

  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  function fmtMoney(n) {
    var cur = (state.settings && state.settings.currency) ? state.settings.currency : 'PLN';
    try {
      return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: cur }).format(n);
    } catch (e) {
      var v = (n == null ? 0 : n);
      return v.toFixed ? v.toFixed(2) + ' ' + cur : (v + ' ' + cur);
    }
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    return new Intl.DateTimeFormat('pl-PL', { year: 'numeric', month: 'short', day: '2-digit' }).format(d);
  }
  function startOfDay(d) { var x = new Date(d); x.setHours(0,0,0,0); return x; }
  function startOfMonth(date) { var d = date ? new Date(date) : new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; }
  function endOfMonth(date) { var d = date ? new Date(date) : new Date(); d.setMonth(d.getMonth()+1, 0); d.setHours(23,59,59,999); return d; }
  function daysBetween(a, b) { var ms = (startOfDay(b) - startOfDay(a)); return Math.round(ms / 86400000); }

  // ======= Motyw =======
  function applyTheme() {
    var theme = (state.settings && state.settings.theme) ? state.settings.theme : 'default';
    if (theme === 'pastel-dark') {
      document.documentElement.setAttribute('data-theme', 'pastel-dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  // ======= Nawigacja =======
  for (var ti = 0; ti < els.tabs.length; ti++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        for (var j = 0; j < els.tabs.length; j++) els.tabs[j].classList.remove('active');
        btn.classList.add('active');
        switchView(btn.getAttribute('data-target'));
      });
    })(els.tabs[ti]);
  }

  function switchView(id) {
    for (var i = 0; i < els.views.length; i++) els.views[i].classList.remove('active');
    var v = document.getElementById(id);
    if (v) v.classList.add('active');
  }

  // ======= Miesięczny filtr =======
  function buildMonthFilter() {
    var now = new Date();
    els.filterMonth.innerHTML = '';
    for (var off = -12; off <= 12; off++) {
      var d = new Date(now.getFullYear(), now.getMonth() + off, 1);
      var opt = document.createElement('option');
      opt.value = d.toISOString();
      opt.textContent = d.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
      if (off === 0) opt.selected = true;
      els.filterMonth.appendChild(opt);
    }
  }

  // ======= Zdarzenia UI =======
  function bindEvents() {
    if (els.btnAdd) {
      els.btnAdd.addEventListener('click', function () {
        clearForm();
        for (var j = 0; j < els.tabs.length; j++) els.tabs[j].classList.remove('active');
        var tabFormBtn = document.querySelector('.tabbar .tab[data-target="view-form"]');
        if (tabFormBtn) tabFormBtn.classList.add('active');
        switchView('view-form');
        if (els.name) els.name.focus();
      });
    }

    if (els.btnSample) {
      els.btnSample.addEventListener('click', function () {
        var today = new Date();
        var demo = [
          { name: 'Czynsz', amount: 1800, dueDate: new Date(today.getFullYear(), today.getMonth(), 10).toISOString(), frequency:'monthly', reminderDays:3 },
          { name: 'Prąd', amount: 210.55, dueDate: new Date(today.getFullYear(), today.getMonth(), 15).toISOString(), frequency:'monthly', reminderDays:2 },
          { name: 'Telefon', amount: 65, dueDate: new Date(today.getFullYear(), today.getMonth(), 25).toISOString(), frequency:'monthly', reminderDays:3 }
        ];
        for (var i = 0; i < demo.length; i++) addBill(demo[i]);
        saveState();
        switchView('view-list');
      });
    }

    if (els.filterMonth) {
      els.filterMonth.addEventListener('change', renderList);
    }

    if (els.frequency) {
      els.frequency.addEventListener('change', function () {
        if (!els.labelInterval) return;
        var show = els.frequency.value === 'custom';
        if (show) els.labelInterval.classList.remove('hidden'); else els.labelInterval.classList.add('hidden');
      });
    }

    if (els.form) {
      els.form.addEventListener('submit', function (e) {
        e.preventDefault();
        var bill = formToBill();
        if (!bill) return;

        if (els.id.value) {
          var idx = findBillIndexById(els.id.value);
          if (idx >= 0) {
            var old = state.bills[idx];
            var upd = copy(old);
            for (var k in bill) upd[k] = bill[k];
            upd.id = els.id.value;
            upd.updatedAt = new Date().toISOString();
            state.bills[idx] = upd;
          }
        } else {
          addBill(bill);
        }
        saveState();
        switchView('view-list');
        for (var j = 0; j < els.tabs.length; j++) els.tabs[j].classList.remove('active');
        var tabListBtn = document.querySelector('.tabbar .tab[data-target="view-list"]');
        if (tabListBtn) tabListBtn.classList.add('active');
        clearForm();
      });
    }

    if (els.btnCancel) {
      els.btnCancel.addEventListener('click', function () {
        clearForm(); switchView('view-list');
        for (var j = 0; j < els.tabs.length; j++) els.tabs[j].classList.remove('active');
        var tabListBtn = document.querySelector('.tabbar .tab[data-target="view-list"]');
        if (tabListBtn) tabListBtn.classList.add('active');
      });
    }

    // Ustawienia
    if (els.settingCurrency) {
      els.settingCurrency.addEventListener('change', function () {
        state.settings.currency = els.settingCurrency.value;
        saveState();
      });
    }
    if (els.settingDefaultReminder) {
      els.settingDefaultReminder.addEventListener('change', function () {
        var v = parseInt(els.settingDefaultReminder.value || '0', 10);
        state.settings.defaultReminderDays = isNaN(v) ? 0 : Math.max(0, v);
        saveState();
      });
    }
    if (els.settingTheme) {
      els.settingTheme.addEventListener('change', function () {
        state.settings.theme = els.settingTheme.value;
        saveState();
        applyTheme();
      });
    }

    if (els.btnExportJson) els.btnExportJson.addEventListener('click', exportJSON);
    if (els.inputImportJson) els.inputImportJson.addEventListener('change', importJSON);
    if (els.btnExportCsv) els.btnExportCsv.addEventListener('click', exportCSV);
    if (els.btnNotifyPerm) els.btnNotifyPerm.addEventListener('click', askNotificationPermission);
    if (els.btnTestNotify) els.btnTestNotify.addEventListener('click', function () { notify('Test', 'To jest testowe powiadomienie.'); });
    if (els.btnUpdateApp) els.btnUpdateApp.addEventListener('click', updateAppNow);

    // Akcje na liście
    if (els.list) {
      els.list.addEventListener('click', function (e) {
        var target = e.target || e.srcElement;
        var item = target.closest ? target.closest('li.bill') : null;
        if (!item) return;
        var id = item.getAttribute('data-id');
        if (!id) return;

        if (target.classList.contains('btn-edit')) {
          var bill = findBillById(id);
          if (bill) billToForm(bill);
          for (var j = 0; j < els.tabs.length; j++) els.tabs[j].classList.remove('active');
          var tabFormBtn = document.querySelector('.tabbar .tab[data-target="view-form"]');
          if (tabFormBtn) tabFormBtn.classList.add('active');
          switchView('view-form');
        } else if (target.classList.contains('btn-del')) {
          if (confirm('Usunąć rachunek?')) {
            state.bills = state.bills.filter(function (b) { return b.id !== id; });
            saveState();
          }
        } else if (target.classList.contains('btn-paid')) {
          markPaid(id);
        } else if (target.classList.contains('btn-calendar')) {
          exportICSForBill(id);
        }
      });
    }
  }

  // ======= Formularz =======
  function formToBill() {
    var name = (els.name.value || '').trim();
    var amount = parseFloat(els.amount.value);
    var dueDate = els.due.value ? new Date(els.due.value) : null;
    var frequency = els.frequency.value;
    var reminderDays = parseInt((els.reminder.value || state.settings.defaultReminderDays), 10);
    var notes = (els.notes.value || '').trim();
    var intervalDays = frequency === 'custom' ? Math.max(2, parseInt(els.interval.value || '30', 10)) : null;

    if (!name || isNaN(amount) || !dueDate) {
      alert('Uzupełnij nazwę, kwotę i termin.');
      return null;
    }
    return {
      id: uid(),
      name: name,
      amount: amount,
      dueDate: dueDate.toISOString(),
      frequency: frequency,
      intervalDays: intervalDays,
      reminderDays: reminderDays,
      notes: notes,
      paid: false,
      lastPaidDate: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function billToForm(b) {
    els.id.value = b.id || '';
    els.name.value = b.name || '';
    els.amount.value = b.amount != null ? b.amount : '';
    els.due.value = b.dueDate ? new Date(b.dueDate).toISOString().slice(0, 10) : '';
    els.frequency.value = b.frequency || 'once';
    if (els.labelInterval) {
      if (els.frequency.value === 'custom') els.labelInterval.classList.remove('hidden');
      else els.labelInterval.classList.add('hidden');
    }
    els.interval.value = b.intervalDays || 30;
    els.reminder.value = (b.reminderDays != null) ? b.reminderDays : state.settings.defaultReminderDays;
    els.notes.value = b.notes || '';
  }

  function clearForm() {
    els.id.value = '';
    if (els.form && els.form.reset) els.form.reset();
    els.frequency.value = 'once';
    if (els.labelInterval) els.labelInterval.classList.add('hidden');
    els.reminder.value = state.settings.defaultReminderDays;
  }

  function addBill(bill) {
    var now = new Date().toISOString();
    if (!bill.id) bill.id = uid();
    if (bill.paid == null) bill.paid = false;
    if (!bill.createdAt) bill.createdAt = now;
    bill.updatedAt = now;
    state.bills.push(bill);
  }

  function findBillById(id) {
    for (var i = 0; i < state.bills.length; i++) if (state.bills[i].id === id) return state.bills[i];
    return null;
  }
  function findBillIndexById(id) {
    for (var i = 0; i < state.bills.length; i++) if (state.bills[i].id === id) return i;
    return -1;
  }
  function copy(obj) {
    var o = {};
    for (var k in obj) o[k] = obj[k];
    return o;
  }

  // ======= Render listy i statystyk =======
  function render() {
    if (els.settingCurrency) els.settingCurrency.value = state.settings.currency;
    if (els.settingDefaultReminder) els.settingDefaultReminder.value = state.settings.defaultReminderDays;
    if (els.settingTheme) els.settingTheme.value = state.settings.theme || 'default';
    applyTheme();
    renderList();
    maybeShowInstall();
    scheduleDueNotifications();
  }

  function renderList() {
    var monthIso = els.filterMonth.value;
    var monthStart = startOfMonth(new Date(monthIso));
    var monthEnd = endOfMonth(new Date(monthIso));
    var today = startOfDay(new Date());

    var inMonth = state.bills.filter(function (b) {
      var d = new Date(b.dueDate);
      return d >= monthStart && d <= monthEnd;
    });

    inMonth.sort(function (a, b) { return new Date(a.dueDate) - new Date(b.dueDate); });

    els.list.innerHTML = '';
    var sumDue = 0, sumPaid = 0, sumNow = 0;
    els.empty.hidden = inMonth.length !== 0;
    for (var i = 0; i < inMonth.length; i++) {
      var b = inMonth[i];
      var li = els.tplItem.content.firstElementChild.cloneNode(true);
      li.setAttribute('data-id', b.id);

      var title = $('.bill-title', li);
      var sub = $('.bill-sub', li);

      var due = new Date(b.dueDate);
      var daysLeft = daysBetween(today, due);

      var status = '';
      var badgeClass = 'ok';
      if (b.paid) {
        status = 'zapłacone';
        badgeClass = 'paid';
        sumPaid += b.amount;
      } else if (due < today) {
        status = 'po terminie';
        badgeClass = 'late';
        sumDue += b.amount;
      } else if (daysLeft <= ((b.reminderDays != null) ? b.reminderDays : state.settings.defaultReminderDays)) {
        status = 'wkrótce (' + daysLeft + ' d.)';
        badgeClass = 'soon';
        sumDue += b.amount;
      } else {
        status = 'za ' + daysLeft + ' d.';
        sumDue += b.amount;
      }
      if (!b.paid && startOfDay(new Date(b.dueDate)) <= today) {
        sumNow += b.amount;   // na dziś
      }

      title.innerHTML = '<span>' + escapeHtml(b.name) + '</span> <span class="badge ' + badgeClass + '">' + status + '</span>';

      var freqLabelMap = {
        once: 'jednorazowo',
        monthly: 'miesięcznie',
        quarterly: 'kwartalnie',
        yearly: 'rocznie',
        custom: 'co ' + (b.intervalDays || 30) + ' dni'
      };
      var freqLabel = freqLabelMap[b.frequency || 'once'];
      sub.textContent = fmtMoney(b.amount) + ' • termin: ' + fmtDate(b.dueDate) + ' • ' + freqLabel;

      $('.btn-paid', li).textContent = b.paid ? '↺' : '✔';
      $('.btn-paid', li).title = b.paid ? 'Oznacz jako niezapłacone' : 'Oznacz jako zapłacone';

      els.list.appendChild(li);
    }

    els.statDue.textContent = fmtMoney(sumDue);
    els.statPaid.textContent = fmtMoney(sumPaid);
    els.statLeft.textContent = fmtMoney(sumNow);
    document.getElementById('stats-strip').classList.toggle('has-due-today', sumNow > 0);

  }

  function escapeHtml(s) {
    s = String(s == null ? '' : s);
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function markPaid(id) {
    var b = findBillById(id);
    if (!b) return;
    b.paid = !b.paid;
    b.lastPaidDate = b.paid ? new Date().toISOString() : null;
    // rachunek cykliczny → utwórz kolejny termin
    if (b.paid && b.frequency && b.frequency !== 'once') {
      var next = nextDueDate(b.frequency, b.dueDate, b.intervalDays);
      var exists = state.bills.some ? state.bills.some(function (x) {
        return x.name === b.name && new Date(x.dueDate).getTime() === new Date(next).getTime();
      }) : false;
      if (!exists) {
        state.bills.push({
          id: uid(),
          name: b.name,
          amount: b.amount,
          dueDate: next,
          frequency: b.frequency,
          intervalDays: b.intervalDays,
          reminderDays: (b.reminderDays != null ? b.reminderDays : state.settings.defaultReminderDays),
          notes: b.notes || '',
          paid: false,
          lastPaidDate: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    }
    b.updatedAt = new Date().toISOString();
    saveState();
  }

  function nextDueDate(freq, isoDate, intervalDays) {
    var d = new Date(isoDate);
    if (freq === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (freq === 'quarterly') d.setMonth(d.getMonth() + 3);
    else if (freq === 'yearly') d.setFullYear(d.getFullYear() + 1);
    else if (freq === 'custom') d.setDate(d.getDate() + Math.max(2, intervalDays || 30));
    return d.toISOString();
  }

  // ======= Export / Import =======
  function exportJSON() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'rachunki.json');
  }
  function importJSON(ev) {
    var file = ev.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.bills)) throw new Error('Zły format');
        for (var i = 0; i < data.bills.length; i++) {
          if (!data.bills[i].id) data.bills[i].id = uid();
        }
        state = merge(state, data);
        saveState();
        alert('Zaimportowano dane.');
      } catch (e) {
        alert('Błąd importu: ' + e.message);
      }
    };
    reader.readAsText(file);
  }
  function exportCSV() {
    var rows = [
      ['Nazwa','Kwota','Termin','Częstotliwość','Interwał(dni)','Przypomnienie(dni)','Notatka','Zapłacone']
    ];
    for (var i = 0; i < state.bills.length; i++) {
      var b = state.bills[i];
      rows.push([
        csvQuote(b.name),
        b.amount,
        new Date(b.dueDate).toISOString().slice(0,10),
        b.frequency,
        b.intervalDays || '',
        (b.reminderDays != null ? b.reminderDays : ''),
        csvQuote(b.notes || ''),
        b.paid ? 'tak' : 'nie'
      ]);
    }
    var csvLines = rows.map(function (r) { return r.join(';'); }).join('\n');
    downloadBlob(new Blob([csvLines], {type:'text/csv;charset=utf-8'}), 'rachunki.csv');
  }
  function csvQuote(s) {
    s = String(s == null ? '' : s);
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ======= Kalendarz (.ics) =======
  function exportICSForBill(id) {
    var b = findBillById(id);
    if (!b) return;
    var ics = buildICS([b]);
    downloadBlob(new Blob([ics], {type:'text/calendar'}), 'rachunek-' + slug(b.name) + '.ics');
  }
  function buildICS(bills) {
    var dtstamp = toICS(new Date());
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//BillReminder//PL//',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ];
    for (var i = 0; i < bills.length; i++) {
      var b = bills[i];
      var due = new Date(b.dueDate);
      var dtstart = toICSDate(due);
      var uidv = uid() + '@billreminder';
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + uidv);
      lines.push('DTSTAMP:' + dtstamp);
      lines.push('SUMMARY:' + escapeICS(b.name + ' – ' + fmtMoney(b.amount)));
      lines.push('DTSTART;VALUE=DATE:' + dtstart);
      lines.push('DESCRIPTION:' + escapeICS(b.notes || 'Rachunek do zapłaty'));
      lines.push('TRANSP:OPAQUE');
      var rdays = isFinite(b.reminderDays) ? b.reminderDays : (state.settings.defaultReminderDays || 0);
      if (rdays >= 0) {
        lines.push('BEGIN:VALARM');
        lines.push('TRIGGER:-P' + Math.max(0, rdays) + 'D');
        lines.push('ACTION:DISPLAY');
        lines.push('DESCRIPTION:' + escapeICS('Przypomnienie: ' + b.name));
        lines.push('END:VALARM');
      }
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }
  function toICS(d){
    var x = new Date(d);
    return x.toISOString().replace(/[-:]/g,'').replace('.000','');
  }
  function toICSDate(d){
    var y = d.getFullYear();
    var m = String(d.getMonth()+1); if (m.length < 2) m = '0' + m;
    var day = String(d.getDate()); if (day.length < 2) day = '0' + day;
    return '' + y + m + day;
  }
  function escapeICS(s){
    s = String(s == null ? '' : s);
    var map = {'\n':'\\n', ',':'\\,',';':'\\;','\\':'\\\\'};
    return s.replace(/[\n,;\\]/g, function(m){ return map[m]; });
  }
  function slug(s){ return String(s == null ? '' : s).toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,''); }

  // ======= Powiadomienia (gdy apka otwarta) =======
  function askNotificationPermission() {
    if (!('Notification' in window)) { alert('Brak wsparcia powiadomień.'); return; }
    Notification.requestPermission().then(function (p) {
      alert(p === 'granted' ? 'Włączono powiadomienia.' : 'Powiadomienia zablokowane.');
    });
  }
  function notify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try { new Notification(title, { body: body }); } catch (e) {}
  }
  function scheduleDueNotifications() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var today = startOfDay(new Date());
    for (var i = 0; i < state.bills.length; i++) {
      var b = state.bills[i];
      if (b.paid) continue;
      var due = startOfDay(new Date(b.dueDate));
      var daysLeft = daysBetween(today, due);
      var r = (b.reminderDays != null) ? b.reminderDays : state.settings.defaultReminderDays;
      if (daysLeft === r || daysLeft === 0) {
        notify('Rachunek: ' + b.name, 'Termin ' + fmtDate(b.dueDate) + ' • Kwota ' + fmtMoney(b.amount));
      }
    }
  }

  // ======= PWA (install) =======
  function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      maybeShowInstall();
    });
    if (els.btnInstall) {
      els.btnInstall.addEventListener('click', function () {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function () {
          deferredPrompt = null;
          els.btnInstall.hidden = true;
        });
      });
    }
  }
  function maybeShowInstall() {
    if (els.btnInstall) els.btnInstall.hidden = !deferredPrompt;
  }

  // ======= Service Worker =======
  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch(function (err) { console.warn(err); });
    }
  }

  // ======= Aktualizacja PWA (czyści SW + cache, przeładowuje) =======
  async function updateAppNow(){
    const btn = document.getElementById('btn-update-app');
    if (btn) { btn.disabled = true; btn.textContent = 'Aktualizowanie…'; }
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) { try { await r.unregister(); } catch(e){} }
      }
      if (window.caches) {
        const names = await caches.keys();
        await Promise.all(names.map(n => caches.delete(n)));
      }
    } finally {
      if (btn) { btn.textContent = 'Aktualizuj aplikację'; btn.disabled = false; }
      location.reload();
    }
  }

})();
