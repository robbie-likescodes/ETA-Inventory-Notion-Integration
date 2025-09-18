/**************** FIXED CONNECTIONS (update if you redeploy) ****************/
// Inventory API (Apps Script /exec)
var BASE_URL = "https://script.google.com/macros/s/AKfycbwOQLFY_CwEjnRaxWG1kbelhpI7gGEiBK-1QWGk0bIVM-YZb1wqk8sTjPa6Zn4mFhbf/exec";
var API_KEY  = "thebluedogisfat";
/***************************************************************************/

/* ---------------- Small helpers ---------------- */
var LS = {
  get: function(k, d){ try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch(e){ return d; } },
  set: function(k, v){ localStorage.setItem(k, JSON.stringify(v)); },
  del: function(k){ localStorage.removeItem(k); }
};
var K = { pin:'inv.pin', tech:'inv.tech', company:'inv.company', queue:'inv.queue', parts:'inv.parts', cats:'inv.cats', locs:'inv.locs' };

function el(id){ return document.getElementById(id); }
function gv(id){ var n = el(id); return (n && n.value ? n.value : '').trim(); }

/* ---------------- Toast ---------------- */
function ensureToastHost(){
  var t = document.querySelector('.toast');
  if (!t){
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  return t;
}
function toast(msg, ms){
  if (ms == null) ms = 2200;
  var t = ensureToastHost();
  t.textContent = msg;
  t.classList.add('show');
  if (t._hide) window.clearTimeout(t._hide);
  t._hide = setTimeout(function(){ t.classList.remove('show'); }, ms);
}

/* ---------------- Panels ---------------- */
function openPanel(id){
  var p = el(id); if (!p) return;
  p.classList.add('show');
  p.classList.remove('hidden');
  p.scrollIntoView({ behavior:'smooth', block:'nearest' });
}
function closePanel(id){
  var p = el(id); if (!p) return;
  p.classList.remove('show');
  p.classList.add('hidden');
}

/* ---------------- Network chip ---------------- */
function setNet(){
  var n = el('net');
  if (n) n.textContent = navigator.onLine ? 'online' : 'offline';
}
window.addEventListener('online', function(){ setNet(); flushQueue(); });
window.addEventListener('offline', setNet);

/* ---------------- API helpers ---------------- */
function apiGET(route, params){
  if (!params) params = {};
  var qp = new URLSearchParams(Object.assign({ route: route }, params)).toString();
  return fetch(BASE_URL + "?" + qp).then(function(r){ return r.json(); }).then(function(j){
    if (!j.ok) throw new Error(j.error || 'GET failed');
    return j;
  });
}
function apiPOST(body){
  var payload = Object.assign({ api_key: API_KEY }, body || {});
  return fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(payload)
  }).then(function(r){ return r.json(); }).then(function(j){
    if (!j.ok) throw new Error(j.error || 'POST failed');
    return j;
  });
}

/* -------------- Post or Queue wrapper -------------- */
function qAll(){ return LS.get(K.queue, []); }
function qPush(p){ var q = qAll(); q.push(p); LS.set(K.queue, q); }
function qSet(items){ LS.set(K.queue, items); }

function flushQueue(){
  var q = qAll();
  if (!q.length || !navigator.onLine) return Promise.resolve();
  if (el('sync')) el('sync').textContent = 'Sync: flushing…';
  var keep = [];
  // chain sequentially to be gentle
  return q.reduce(function(p, item){
    return p.then(function(){
      return apiPOST(item).catch(function(){ keep.push(item); });
    });
  }, Promise.resolve()).then(function(){
    qSet(keep);
    if (el('sync')) el('sync').textContent = keep.length ? ('Sync: retrying ('+keep.length+')') : 'Sync: idle';
  });
}

function submitOrQueue(body, successMsg){
  if (!navigator.onLine){
    qPush(body);
    toast('Submission queued; will upload when back online.');
    return Promise.resolve({ queued:true });
  }
  return apiPOST(body).then(function(res){
    toast(successMsg || 'Submitted');
    return res;
  }).catch(function(err){
    var m = String(err && err.message || '');
    if (/Failed to fetch|NetworkError|TypeError/.test(m)){
      qPush(body);
      toast('Submission queued; will upload when back online.');
      return { queued:true };
    }
    throw err;
  });
}

/* ---------------- Auth ---------------- */
function isAuthed(){ return !!LS.get(K.pin, null); }
function login(pin){
  return apiPOST({ kind:'login', pin: pin }).then(function(){ LS.set(K.pin, pin); return true; });
}

/* ---------------- Lists ---------------- */
function loadLocs(){
  return apiGET('locs').then(function(j){
    LS.set(K.locs, j.locs || []);
  }).catch(function(){
    LS.set(K.locs, ['Office','Shop','CrashBox','Van1','Van2','Van3','Van4']);
  });
}
function loadParts(){
  return apiGET('parts').then(function(j){
    var ids = (j.parts || []).map(function(p){ return p.PartID; });
    LS.set(K.parts, ids);
  }).catch(function(){ /* ignore */ }).then(function(){
    var ids = LS.get(K.parts, []);
    var dl = el('partsList');
    if (dl) dl.innerHTML = ids.map(function(id){ return '<option value="'+id+'">'; }).join('');
  });
}
function loadCats(){
  return apiGET('cats').then(function(j){
    LS.set(K.cats, j.cats || []);
  }).catch(function(){ /* ignore */ }).then(function(){
    var cats = LS.get(K.cats, []);
    var dl = el('catsList');
    if (dl) dl.innerHTML = cats.map(function(c){ return '<option value="'+c+'">'; }).join('');
  });
}
function autoCat(partId){
  if (!partId) return Promise.resolve('');
  return apiGET('autocat', { partId: partId }).then(function(j){ return j.category || ''; }).catch(function(){ return ''; });
}

/* ---------------- UI pieces ---------------- */
function locOptionsHtml(){
  var locs = LS.get(K.locs, []);
  return ['<option value="" disabled>Select location…</option>','<option value="N/A">N/A</option>']
    .concat(locs.map(function(l){ return '<option value="'+l+'">'+l+'</option>'; })).join('');
}
function actionSelectHtml(val){
  if (!val) val='used';
  var opts = [['used','Use'],['received','Receive'],['moved','Move']];
  return '<select data-field="action">' + opts.map(function(p){
    var v=p[0], l=p[1]; return '<option value="'+v+'" '+(v===val?'selected':'')+'>'+l+'</option>';
  }).join('') + '</select>';
}
function categoryInputHtml(){ return '<input data-field="company" list="catsList" placeholder="Category (e.g. BUNN)"/>'; }
function bulkRowHtml(){
  return ''+
  '<tr>'+
    '<td style="padding:6px"><input data-field="partId" list="partsList" placeholder="PartID"/></td>'+
    '<td style="padding:6px">'+categoryInputHtml()+'</td>'+
    '<td style="padding:6px">'+actionSelectHtml()+'</td>'+
    '<td style="padding:6px"><select data-field="fromLoc">'+locOptionsHtml()+'</select></td>'+
    '<td style="padding:6px"><select data-field="toLoc">'+locOptionsHtml()+'</select></td>'+
    '<td class="qty" style="padding:6px;text-align:right"><input data-field="qty" type="number" min="0.01" step="0.01" style="width:110px;text-align:right"/></td>'+
    '<td style="padding:6px"><button type="button" data-action="remove">✕</button></td>'+
  '</tr>';
}
function enforceRowAction(tr){
  var actionEl = tr.querySelector('[data-field="action"]');
  var action = actionEl ? actionEl.value : 'used';
  var fromSel = tr.querySelector('[data-field="fromLoc"]');
  var toSel   = tr.querySelector('[data-field="toLoc"]');
  if (!fromSel || !toSel) return;
  if (action === 'used'){
    if (!fromSel.value || fromSel.value === 'N/A') fromSel.value = '';
    toSel.value = 'N/A'; toSel.disabled = true; fromSel.disabled = false;
  } else if (action === 'received'){
    if (!toSel.value || toSel.value === 'N/A') toSel.value = '';
    fromSel.value = 'N/A'; fromSel.disabled = true; toSel.disabled = false;
  } else {
    if (toSel.value === 'N/A') toSel.value = '';
    if (fromSel.value === 'N/A') fromSel.value = '';
    fromSel.disabled = false; toSel.disabled = false;
  }
}

/* ---------------- Count Mode ---------------- */
var lastCountCat = '';
function renderCountTable(row){
  var locs = LS.get(K.locs, []);
  var hasMap = row && row.locations && typeof row.locations === 'object';
  var rows = locs.map(function(l){
    var cur = hasMap ? Number(row.locations[l] || 0) : 0;
    return ''+
      '<tr>'+
        '<td style="padding:8px">'+l+'</td>'+
        '<td style="padding:8px;text-align:right">'+cur+'</td>'+
        '<td style="padding:8px;text-align:right">'+
          '<input data-loc="'+l+'" type="number" step="1" value="'+cur+'" '+
            'style="width:120px;text-align:right;background:#111;color:#eee;border:1px solid #333;border-radius:8px;padding:6px"/>'+
        '</td>'+
      '</tr>';
  }).join('');
  var table = el('countTable');
  if (table){
    table.innerHTML = '<thead><tr><th style="text-align:left;padding:8px">Location</th><th style="text-align:right;padding:8px">Current</th><th style="text-align:right;padding:8px">New</th></tr></thead><tbody>'+rows+'</tbody>';
  }
}
function loadCountPart(){
  var partId = gv('countPartId');
  if (!partId){ toast('Enter a PartID'); return; }
  autoCat(partId).then(function(company){
    if (!company){ toast('No category found for this PartID'); return; }
    lastCountCat = company;
    return apiGET('part', { company: company, partId: partId }).then(function(j){
      el('countMeta').textContent = company+' — '+partId;
      renderCountTable(j.row || {});
    });
  }).catch(function(e){
    alert('Could not load part row: ' + (e && e.message || e));
  });
}

/* ---------------- Recent list ---------------- */
function prependRecent(text){
  var list = el('recent'); if (!list) return;
  var li = document.createElement('li');
  li.textContent = text;
  list.prepend(li);
}

/* ---------------- History ---------------- */
function loadTechs(){
  var sel = el('historyTech'); if (!sel) return Promise.resolve();
  sel.disabled = true;
  sel.innerHTML = '<option value="">(loading…)</option>';
  return apiGET('techs').then(function(j){
    var techs = j.techs || [];
    var me = gv('tech');
    if (me && techs.indexOf(me) < 0) techs.unshift(me);
    sel.innerHTML = techs.length ? techs.map(function(t){ return '<option>'+t+'</option>'; }).join('')
                                 : '<option value="">(no records yet)</option>';
    sel.selectedIndex = 0;
  }).catch(function(){
    sel.innerHTML = '<option value="">(load failed)</option>';
  }).finally ? sel.disabled = false : (sel.disabled = false);
}
function showHistFields(by){
  var blocks = { tech:'histFieldTech', daterange:'histFieldDate', category:'histFieldCategory', part:'histFieldPart', job:'histFieldJob' };
  Object.keys(blocks).forEach(function(k){ var n = el(blocks[k]); if (n) n.classList.add('hidden'); });
  var tgt = blocks[by]; if (tgt){ var n2 = el(tgt); if (n2) n2.classList.remove('hidden'); }
}
function renderHistory(items){
  var host = el('historyList'); if (!host) return;
  if (!items || !items.length){ host.innerHTML = '<div class="muted small">No records.</div>'; return; }
  var rows = items.map(function(it){
    var when = it.ts ? new Date(it.ts).toLocaleString() : '';
    var move =
      it.action==='moved'    ? (it.qty+' '+it.partId+' ('+(it.fromLoc||'—')+'→'+(it.toLoc||'—')+')') :
      it.action==='used'     ? (it.qty+' '+it.partId+' (from '+(it.fromLoc||'—')+')') :
      it.action==='received' ? (it.qty+' '+it.partId+' (to '+(it.toLoc||'—')+')') :
      it.action==='count'    ? ('count Δ='+it.qty+' '+it.partId) :
      it.action==='backorder'? ('BO '+it.qty+' '+it.partId) : (it.qty+' '+it.partId);
    var extra = [it.category || it.company, it.jobCode].filter(Boolean).join(' • ');
    var note = it.note ? (' — '+it.note) : '';
    var canEdit = ['count','backorder'].indexOf(String(it.action||'')) < 0;
    var buttons = canEdit
      ? '<button type="button" data-edit="'+it.requestId+'" class="small">Edit</button> '+
        '<button type="button" data-void="'+it.requestId+'" class="small">Delete</button>'
      : '<span class="muted small">(locked)</span>';
    return '<li data-id="'+it.requestId+'">'+
      '<strong>'+when+'</strong> — '+move+' <span class="muted small">'+extra+'</span>'+note+
      '<div class="inline" style="margin-top:4px;gap:6px">'+buttons+'</div>'+
    '</li>';
  }).join('');
  host.innerHTML = '<ul id="recent">'+rows+'</ul>';
}
function confirmChange(whenStr){ return confirm('This was completed on '+(whenStr || 'this date')+'. Change your submission?'); }
function confirmDelete(whenStr){ return confirm('This was completed on '+(whenStr || 'this date')+'. Delete (void) this submission?'); }

/* ---------------- Notion helpers (via proxy) ---------------- */
function notionLookupByJobCode(jobCode){ return apiPOST({ action:'lookupTask', jobCode: jobCode }); }
function notionMarkPartsLogged(jobCode, desired){ if (!desired) desired='Parts Logged'; return apiPOST({ action:'logParts', jobCode: jobCode, partsStatus: desired }); }

/* ---------------- Boot ---------------- */
window.addEventListener('DOMContentLoaded', function(){
  setNet();

  // Login gate
  if (isAuthed()){
    var g = el('gate'); if (g) g.classList.add('hidden');
    var a = el('app');  if (a) a.classList.remove('hidden');
  }
  var loginForm = el('loginForm');
  if (loginForm){
    loginForm.addEventListener('submit', function(e){
      e.preventDefault();
      var msg = el('loginMsg'); if (msg) msg.textContent = '';
      var pin = gv('pin');
      login(pin).then(function(){
        var g = el('gate'); if (g) g.classList.add('hidden');
        var a = el('app');  if (a) a.classList.remove('hidden');
      }).catch(function(){
        var m = el('loginMsg'); if (m) m.textContent = 'Incorrect PIN or server error.';
      });
    });
  }

  // Remember tech & default Category
  var techInput = el('tech');
  var compInput = el('company'); // note: top-level company field is not in the HTML; per-row company is used
  if (techInput) techInput.value = LS.get(K.tech, '');
  if (compInput) compInput.value = LS.get(K.company, '');
  if (techInput) techInput.addEventListener('change', function(){ LS.set(K.tech, gv('tech')); });
  if (compInput) compInput.addEventListener('change', function(){ LS.set(K.company, gv('company')); });

  // Load lists
  Promise.resolve()
    .then(loadLocs)
    .then(loadParts)
    .then(loadCats);

  // Seed one empty bulk row
  var bulkTable = el('bulkTable');
  if (bulkTable){
    var tb = bulkTable.querySelector('tbody');
    if (tb){ tb.insertAdjacentHTML('beforeend', bulkRowHtml()); }
    var allRows = bulkTable.querySelectorAll('tbody tr');
    Array.prototype.forEach.call(allRows, enforceRowAction);
  }

  /* === Bulk behaviors === */
  var bulkAdd = el('bulkAdd');
  if (bulkAdd){
    bulkAdd.addEventListener('click', function(){
      var tb = el('bulkTable') && el('bulkTable').querySelector('tbody');
      if (!tb) return;
      tb.insertAdjacentHTML('beforeend', bulkRowHtml());
      var tr = el('bulkTable').querySelector('tbody tr:last-child');
      if (tr) enforceRowAction(tr);
    });
  }

  if (bulkTable){
    bulkTable.addEventListener('change', function(e){
      var tr = e.target.closest ? e.target.closest('tr') : null; if (!tr) return;

      if (e.target.matches && e.target.matches('[data-field="action"]')){ enforceRowAction(tr); return; }

      if (e.target.matches && e.target.matches('[data-field="partId"]')){
        var partId = (e.target.value || '').trim();
        var rowCat = tr.querySelector('[data-field="company"]');
        if (partId && rowCat && !rowCat.value){
          autoCat(partId).then(function(cat){
            if (cat) rowCat.value = cat;
            if (!rowCat.value && compInput && compInput.value) rowCat.value = compInput.value;
          });
        } else if (rowCat && !rowCat.value && compInput && compInput.value){
          rowCat.value = compInput.value;
        }
      }
    });
    bulkTable.addEventListener('click', function(e){
      if (e.target && e.target.getAttribute('data-action') === 'remove'){
        var tr = e.target.closest ? e.target.closest('tr') : null;
        if (tr) tr.remove();
      }
    });
  }

  // Submit All
  var submitting = false;
  var btnSubmit = el('bulkSubmit');
  if (btnSubmit){
    btnSubmit.addEventListener('click', function(){
      if (submitting) return;
      var tech = gv('tech');
      if (!tech){ alert('Technician is required.'); return; }

      var rows = Array.prototype.slice.call((el('bulkTable') && el('bulkTable').querySelectorAll('tbody tr')) || []);
      if (!rows.length){ alert('Add at least one line.'); return; }

      var defaultCat = gv('company');
      var jobCode = gv('jobCode');
      var note = gv('note');

      var items = rows.map(function(tr){
        function get(name){ var n = tr.querySelector('[data-field="'+name+'"]'); return n ? n.value : ''; }
        var action = (get('action') || 'used').toLowerCase();
        var fromLoc = get('fromLoc');
        var toLoc   = get('toLoc');
        var company = (get('company') || defaultCat).trim();

        if (action === 'used'){ if (!fromLoc || fromLoc === 'N/A') fromLoc = ''; toLoc = 'N/A'; }
        else if (action === 'received'){ if (!toLoc || toLoc === 'N/A') toLoc = ''; fromLoc = 'N/A'; }
        else { if (fromLoc === 'N/A') fromLoc=''; if (toLoc === 'N/A') toLoc=''; }

        var qty = String(parseFloat(get('qty') || '0') || 0);
        return {
          company: company,
          tech: tech,
          action: action,
          partId: (get('partId') || '').trim(),
          qty: qty,
          fromLoc: fromLoc,
          toLoc: toLoc,
          jobCode: jobCode,
          note: note,
          requestId: (window.crypto && crypto.randomUUID ? crypto.randomUUID() : ('r-'+Date.now()+Math.random().toString(16).slice(2)))
        };
      }).filter(function(it){ return it.company && it.partId && parseFloat(it.qty) > 0; });

      if (!items.length){ alert('Each row needs Category, PartID and Qty.'); return; }
      for (var i=0;i<items.length;i++){
        var it = items[i];
        if (it.action==='used' && !it.fromLoc){ alert('Row '+it.partId+': select FROM location.'); return; }
        if (it.action==='received' && !it.toLoc){ alert('Row '+it.partId+': select TO location.'); return; }
        if (it.action==='moved' && (!it.fromLoc || !it.toLoc)){ alert('Row '+it.partId+': select BOTH From and To.'); return; }
      }

      submitting = true;
      btnSubmit.disabled = true;
      submitOrQueue({ kind:'batch', items: JSON.stringify(items) }, 'Parts submitted successfully')
        .then(function(){
          items.forEach(function(it){
            prependRecent(it.company+': '+it.tech+' '+it.action+' '+it.qty+' × '+it.partId+' ('+(it.fromLoc||'—')+'→'+(it.toLoc||'—')+')');
          });
          var tb = el('bulkTable') && el('bulkTable').querySelector('tbody');
          if (tb){
            tb.innerHTML = '';
            tb.insertAdjacentHTML('beforeend', bulkRowHtml());
            var last = el('bulkTable').querySelector('tbody tr:last-child');
            if (last) enforceRowAction(last);
          }
          var noteEl = el('note'); if (noteEl) noteEl.value = '';
          return flushQueue().then(loadParts).then(loadCats);
        })
        .catch(function(e){ alert('Bulk submit failed: '+(e && e.message || e)); })
        .finally ? (submitting=false, btnSubmit.disabled=false)
                 : (submitting=false, btnSubmit.disabled=false);
    });
  }

  /* ======================== TOOLS: COUNT ======================== */
  var btnCount = el('btnCount'); if (btnCount) btnCount.addEventListener('click', function(){ openPanel('panelCount'); var n=el('countPartId'); if(n) n.focus(); });
  var btnCloseCount = el('btnCloseCount'); if (btnCloseCount) btnCloseCount.addEventListener('click', function(){ closePanel('panelCount'); });
  var countPartId = el('countPartId'); if (countPartId) countPartId.addEventListener('change', loadCountPart);
  var btnSaveCounts = el('btnSaveCounts'); if (btnSaveCounts) btnSaveCounts.addEventListener('click', function(){
    var partId = gv('countPartId');
    var tech   = gv('tech');
    var companyPromise = lastCountCat ? Promise.resolve(lastCountCat) : autoCat(partId);
    companyPromise.then(function(company){
      if (!company || !partId || !tech){ alert('PartID, Category, and Tech required.'); return; }
      var inputs = (el('countTable') && el('countTable').querySelectorAll('input[data-loc]')) || [];
      inputs = Array.prototype.slice.call(inputs);
      var rows = inputs.map(function(inp){ return { locId: inp.getAttribute('data-loc'), qty: Number(inp.value || 0) }; });
      var payload = { kind:'count', company:company, tech:tech, partId:partId, counts: JSON.stringify(rows), note: gv('note'), jobCode: gv('jobCode') };
      submitOrQueue(payload, 'Counts saved').then(function(){
        prependRecent(tech+' counted '+partId+' ('+company+')');
        closePanel('panelCount');
      }).catch(function(e){ alert('Save failed: '+(e && e.message || e)); });
    });
  });

  /* ====================== TOOLS: BACKORDER ====================== */
  var btnBackorder = el('btnBackorder'); if (btnBackorder) btnBackorder.addEventListener('click', function(){
    openPanel('panelBackorder');
    var topCat = gv('company'); if (topCat) { var boc = el('boCategory'); if (boc) boc.value = topCat; }
    var bop = el('boPartId'); if (bop) bop.focus();
  });
  var btnCloseBackorder = el('btnCloseBackorder'); if (btnCloseBackorder) btnCloseBackorder.addEventListener('click', function(){ closePanel('panelBackorder'); });
  var boPartId = el('boPartId'); if (boPartId) boPartId.addEventListener('change', function(e){
    var pid = (e.target.value || '').trim(); if (!pid) return;
    autoCat(pid).then(function(cat){ var boc=el('boCategory'); if (cat && boc && !boc.value) boc.value = cat; });
  });
  var btnSubmitBackorder = el('btnSubmitBackorder'); if (btnSubmitBackorder) btnSubmitBackorder.addEventListener('click', function(){
    var partId = gv('boPartId');
    var company = gv('boCategory');
    var qtyStr = gv('boQty') || '1';
    var expected = gv('boExpected') ? String(Date.parse(gv('boExpected'))) : '';
    var note = gv('boNote');
    if (!partId){ alert('PartID required.'); return; }
    var getCompany = company ? Promise.resolve(company) : autoCat(partId);
    getCompany.then(function(c){
      if (!c){ alert('Category required.'); return; }
      var payload = {
        kind:'backorder',
        company:c, partId:partId,
        qty:String(parseFloat(qtyStr)||0),
        requestedBy: gv('tech'),
        expectedDate: expected,
        note: note,
        requestId: (window.crypto && crypto.randomUUID ? crypto.randomUUID() : ('bo-'+Date.now()))
      };
      submitOrQueue(payload, 'Backorder submitted').then(function(){
        prependRecent('backorder '+payload.qty+' × '+payload.partId+' ('+c+')');
        closePanel('panelBackorder');
        var q=el('boQty'); if(q) q.value='';
        var ex=el('boExpected'); if(ex) ex.value='';
        var no=el('boNote'); if(no) no.value='';
      }).catch(function(e){ alert('Backorder failed: '+(e && e.message || e)); });
    });
  });

  /* ======================= TOOLS: HISTORY ======================= */
  var btnHistory = el('btnHistory'); if (btnHistory) btnHistory.addEventListener('click', function(){ openPanel('panelHistory'); loadTechs().then(function(){ showHistFields(gv('histFilter') || 'tech'); }); });
  var historyClose = el('historyClose'); if (historyClose) historyClose.addEventListener('click', function(){ closePanel('panelHistory'); });
  var histFilter = el('histFilter'); if (histFilter) histFilter.addEventListener('change', function(e){ showHistFields(e.target.value); });
  var historyLoad = el('historyLoad'); if (historyLoad) historyLoad.addEventListener('click', function(){
    var by = gv('histFilter') || 'tech';
    var limit = String(parseInt(gv('historyLimit') || '100'));
    var params = { limit: limit };
    if (by === 'tech') params.tech = gv('historyTech');
    if (by === 'daterange') { params.start = gv('historyStart'); params.end = gv('historyEnd'); }
    if (by === 'category') params.category = gv('historyCategory');
    if (by === 'part')     params.partId   = gv('historyPart');
    if (by === 'job')      params.jobCode  = gv('historyJob');
    var p = (by === 'tech' && !params.start && !params.category && !params.partId && !params.jobCode)
      ? apiGET('history', { tech: params.tech, limit: params.limit })
      : apiGET('historysearch', params);
    p.then(function(j){ renderHistory(j.items || []); })
     .catch(function(e){ alert('Failed to load history: '+(e && e.message || e)); });
  });
  var historyList = el('historyList'); if (historyList) historyList.addEventListener('click', function(e){
    var editId = e.target && e.target.getAttribute('data-edit');
    var voidId = e.target && e.target.getAttribute('data-void');
    if (!editId && !voidId) return;
    var li = e.target.closest ? e.target.closest('li') : null;
    var whenStr = li ? (li.querySelector('strong') ? li.querySelector('strong').textContent : '') : '';
    if (voidId){
      if (!confirmDelete(whenStr)) return;
      submitOrQueue({ kind:'void', requestId:voidId, tech:gv('tech') }, 'Submission voided')
        .then(function(){ var btn=el('historyLoad'); if (btn) btn.click(); })
        .catch(function(err){ alert('Delete failed: '+(err && err.message || err)); });
      return;
    }
    if (editId){
      if (!confirmChange(whenStr)) return;
      var a = prompt('Action (used, received, moved):', 'used'); if (!a) return;
      var action = a.trim().toLowerCase();
      if (['used','received','moved'].indexOf(action) < 0) return alert('Invalid action.');
      var fromLoc = '', toLoc = '';
      if (action==='used'){ fromLoc = (prompt('From location (required):','')||'').trim(); toLoc = 'N/A'; }
      else if (action==='received'){ fromLoc = 'N/A'; toLoc = (prompt('To location (required):','')||'').trim(); }
      else { fromLoc = (prompt('From location (required):','')||'').trim(); toLoc = (prompt('To location (required):','')||'').trim(); }
      var q = prompt('Quantity:', '1'); if (q===null) return;
      var qty = q.trim();
      var n = prompt('Note (optional):',''); var note = n ? n.trim() : '';
      submitOrQueue({ kind:'edit', requestId:editId, tech:gv('tech'),
        action:action, fromLoc:fromLoc, toLoc:toLoc, qty:qty, note:note, jobCode:gv('jobCode') }, 'Submission corrected')
        .then(function(){ var btn=el('historyLoad'); if (btn) btn.click(); })
        .catch(function(err){ alert('Edit failed: '+(err && err.message || err)); });
    }
  });

  /* ======================= NOTION BUTTONS ======================= */
  var btnLookup = el('btnLookupTask');
  var btnLogged = el('btnMarkLogged');

  if (btnLookup){
    btnLookup.addEventListener('click', function(){
      var code = gv('jobCode');
      if (!code){ alert('Enter a Job Code first.'); return; }
      notionLookupByJobCode(code).then(function(res){
        if (res && res.ok && res.found && res.task){
          var t = res.task;
          el('taskName').textContent = t.name || '(Untitled)';
          el('taskOpen').href = t.url || '#';
          el('taskJobCode').textContent = t.jobCode || code;
          el('taskPartsStatus').textContent = t.partsStatus || '—';
          el('taskDue').textContent = t.due ? new Date(t.due).toLocaleDateString() : '—';
          el('taskCard').style.display = 'block';
          toast('Task loaded from Notion');
        } else {
          el('taskCard').style.display = 'none';
          toast('No task found for that Job Code');
        }
      }).catch(function(e){
        alert('Lookup failed: ' + (e && e.message || e));
      });
    });
  }
  if (btnLogged){
    btnLogged.addEventListener('click', function(){
      var code = gv('jobCode');
      if (!code){ alert('Enter a Job Code first.'); return; }
      notionMarkPartsLogged(code, 'Parts Logged').then(function(res){
        if (res && res.ok){
          toast('Parts Status updated in Notion');
          return notionLookupByJobCode(code).then(function(again){
            if (again && again.task){
              el('taskPartsStatus').textContent = again.task.partsStatus || 'Parts Logged';
              el('taskCard').style.display = 'block';
            }
          });
        } else {
          alert('Update failed: ' + (res && res.error || 'unknown'));
        }
      }).catch(function(e){
        alert('Update failed: ' + (e && e.message || e));
      });
    });
  }
});
