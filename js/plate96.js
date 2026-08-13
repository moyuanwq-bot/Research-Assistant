(function () {
  'use strict';

  var STORAGE_KEY = 'labtools.plates.v1';

  var TYPE_DEFS = [
    { id: 'sample',   label: '样品',   color: '#6fb8c8' },
    { id: 'standard', label: '标准品', color: '#f2c96b' },
    { id: 'blank',    label: '空白',   color: '#cfe3d8' },
    { id: 'control',  label: '对照',   color: '#e9b8c4' },
    { id: 'other',    label: '其他',   color: '#b9b4d8' }
  ];

  var ROWS = 'ABCDEFGH';
  var COLS = 12;

  var plates = loadPlates();
  var currentId = plates.length ? plates[0].id : null;

  var plateEl = document.getElementById('plate');
  var plateList = document.getElementById('plateList');
  var legendEl = document.getElementById('legend');
  var statsEl = document.getElementById('stats');
  var searchInput = document.getElementById('searchInput');
  var modalMask = document.getElementById('modalMask');
  var modalTitle = document.getElementById('modalTitle');
  var modalWellId = document.getElementById('modalWellId');
  var typeOptions = document.getElementById('typeOptions');
  var wellNote = document.getElementById('wellNote');
  var editingWell = null;

  var multiSelectBtn = document.getElementById('multiSelectBtn');
  var selectionBar = document.getElementById('selectionBar');
  var selectionInfo = document.getElementById('selectionInfo');
  var batchEditBtn = document.getElementById('batchEditBtn');
  var batchClearBtn = document.getElementById('batchClearBtn');
  var clearSelectionBtn = document.getElementById('clearSelectionBtn');
  var selected = {};
  var multiSelectMode = false;
  var batchMode = false;
  var dragState = null;

  function defaultPlates() {
    return [{ id: 'default', name: '默认实验板', wells: {} }];
  }

  function loadPlates() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var data = raw ? JSON.parse(raw) : null;
      if (Array.isArray(data) && data.length) return data;
    } catch (e) { /* ignore */ }
    return defaultPlates();
  }

  function savePlates() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plates));
  }

  function getCurrent() {
    return plates.find(function (p) { return p.id === currentId; }) || plates[0];
  }

  function wellKey(row, col) { return ROWS[row] + (col + 1); }

  function typeById(id) {
    return TYPE_DEFS.find(function (t) { return t.id === id; }) || TYPE_DEFS[TYPE_DEFS.length - 1];
  }

  /* ---------- render ---------- */

  function renderPlateList() {
    plateList.innerHTML = '';
    plates.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + '（' + countFilled(p.wells) + ' 孔）';
      plateList.appendChild(opt);
    });
    plateList.value = currentId;
  }

  function countFilled(wells) {
    var n = 0;
    for (var k in wells) if (wells[k] && wells[k].type) n++;
    return n;
  }

  function renderLegend() {
    var counts = {};
    TYPE_DEFS.forEach(function (t) { counts[t.id] = 0; });
    var wells = getCurrent().wells;
    Object.keys(wells).forEach(function (k) {
      if (wells[k] && counts[wells[k].type] !== undefined) counts[wells[k].type]++;
    });
    legendEl.innerHTML = '';
    TYPE_DEFS.forEach(function (t) {
      var item = document.createElement('span');
      item.className = 'legend-item';
      item.innerHTML = '<span class="legend-dot" style="background:' + t.color + '"></span>' +
        t.label + '<span class="legend-count">× ' + counts[t.id] + '</span>';
      legendEl.appendChild(item);
    });
  }

  function renderPlate() {
    plateEl.innerHTML = '';
    plateEl.appendChild(label('', ''));
    for (var c = 0; c < COLS; c++) plateEl.appendChild(label(String(c + 1), 'plate-label'));
    for (var r = 0; r < ROWS.length; r++) {
      plateEl.appendChild(label(ROWS[r], 'plate-label'));
      for (var col = 0; col < COLS; col++) {
        var well = document.createElement('button');
        well.className = 'well';
        well.dataset.row = r;
        well.dataset.col = col;
        well.title = wellKey(r, col);
        well.addEventListener('click', onWellClick);
        plateEl.appendChild(well);
      }
    }
    applyWellStyles();
  }

  function label(text, cls) {
    var el = document.createElement('div');
    el.className = 'plate-label' + (cls === 'plate-label' ? '' : '');
    el.textContent = text;
    return el;
  }

  function applyWellStyles() {
    var wells = getCurrent().wells;
    var query = searchInput.value.trim().toLowerCase();
    var hasQuery = query.length > 0;
    var matched = 0;

    Array.prototype.forEach.call(plateEl.querySelectorAll('.well'), function (wellEl) {
      var key = wellKey(+wellEl.dataset.row, +wellEl.dataset.col);
      var data = wells[key];
      wellEl.className = 'well';
      if (selected[key]) wellEl.classList.add('selected');
      if (data && data.type) {
        wellEl.classList.add('filled', data.type);
        wellEl.dataset.note = (data.note || '').slice(0, 6);
      } else {
        delete wellEl.dataset.note;
      }
      if (hasQuery) {
        var text = (data ? (data.note || '') : '').toLowerCase() + ' ' +
          (data && data.type ? typeById(data.type).label : '');
        var isMatch = data && text.indexOf(query) !== -1;
        if (isMatch) { wellEl.classList.add('match'); matched++; }
        else wellEl.classList.add('dim');
      }
    });

    renderStats(matched, hasQuery);
  }

  function renderStats(matched, hasQuery) {
    var wells = getCurrent().wells;
    var filled = countFilled(wells);
    var html = '<span>已标记 <b>' + filled + '</b> / 96</span>';
    if (hasQuery) html += '<span>命中 <b>' + matched + '</b> 个孔</span>';
    statsEl.innerHTML = html;
  }

  function renderAll() {
    renderPlateList();
    renderLegend();
    renderPlate();
    renderSelection();
  }

  /* ---------- multi-select ---------- */

  function selectedKeys() { return Object.keys(selected); }

  function toggleSelect(key) {
    if (selected[key]) delete selected[key];
    else selected[key] = true;
    renderSelection();
    applyWellStyles();
  }

  function clearSelection() {
    selected = {};
    renderSelection();
    applyWellStyles();
  }

  function renderSelection() {
    var keys = selectedKeys();
    selectionBar.hidden = !multiSelectMode;
    selectionInfo.textContent = '已选中 ' + keys.length + ' 个孔';
    updateSelectionButtons();
  }

  function updateSelectionButtons() {
    var hasSelection = selectedKeys().length > 0;
    batchEditBtn.disabled = !hasSelection;
    batchClearBtn.disabled = !hasSelection;
    clearSelectionBtn.disabled = !hasSelection;
  }

  function openBatchEditor() {
    var keys = selectedKeys();
    if (!keys.length) return;
    batchMode = true;
    editingWell = null;
    modalTitle.textContent = '批量标记 ' + keys.length + ' 个孔';
    modalWellId.textContent = '将统一设置选中孔的类型与内容（内容可留空）';
    document.getElementById('clearWellBtn').textContent = '清除选中孔标记';
    buildTypeOptions(TYPE_DEFS[0].id);
    wellNote.value = '';
    modalMask.classList.add('show');
    setTimeout(function () { wellNote.focus(); }, 50);
  }

  /* ---------- drag select ---------- */

  function createSelectRect() {
    var rect = document.createElement('div');
    rect.className = 'select-rect';
    document.body.appendChild(rect);
    return rect;
  }

  function updateSelectRect(rect, x1, y1, x2, y2) {
    rect.style.left = Math.min(x1, x2) + 'px';
    rect.style.top = Math.min(y1, y2) + 'px';
    rect.style.width = Math.abs(x2 - x1) + 'px';
    rect.style.height = Math.abs(y2 - y1) + 'px';
  }

  function onDragMove(ev) {
    if (!dragState) return;
    var dx = ev.clientX - dragState.startX;
    var dy = ev.clientY - dragState.startY;
    if (!dragState.moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      dragState.moved = true;
      dragState.base = dragState.additive ? Object.keys(selected).reduce(function (o, k) { o[k] = true; return o; }, {}) : {};
    }
    if (!dragState.moved) return;

    updateSelectRect(dragState.rectEl, dragState.startX, dragState.startY, ev.clientX, ev.clientY);

    var x1 = Math.min(dragState.startX, ev.clientX);
    var x2 = Math.max(dragState.startX, ev.clientX);
    var y1 = Math.min(dragState.startY, ev.clientY);
    var y2 = Math.max(dragState.startY, ev.clientY);

    var next = {};
    Object.keys(dragState.base).forEach(function (k) { next[k] = true; });
    Array.prototype.forEach.call(plateEl.querySelectorAll('.well'), function (wellEl) {
      var r = wellEl.getBoundingClientRect();
      if (r.right >= x1 && r.left <= x2 && r.bottom >= y1 && r.top <= y2) {
        next[wellKey(+wellEl.dataset.row, +wellEl.dataset.col)] = true;
      }
    });
    selected = next;
    renderSelection();
    applyWellStyles();
  }

  function suppressNextClick() {
    var handler = function (ev) {
      ev.stopPropagation();
      ev.preventDefault();
    };
    document.addEventListener('click', handler, true);
    setTimeout(function () {
      document.removeEventListener('click', handler, true);
    }, 0);
  }

  function onDragEnd() {
    if (!dragState) return;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.body.classList.remove('dragging');
    if (dragState.moved) suppressNextClick();
    if (dragState.rectEl && dragState.rectEl.parentNode) dragState.rectEl.parentNode.removeChild(dragState.rectEl);
    dragState = null;
  }

  function onPlateMouseDown(ev) {
    if (ev.button !== 0) return;
    if (!multiSelectMode) return;
    dragState = {
      startX: ev.clientX,
      startY: ev.clientY,
      moved: false,
      additive: ev.ctrlKey || ev.shiftKey || ev.metaKey,
      base: {},
      rectEl: createSelectRect()
    };
    document.body.classList.add('dragging');
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }

  /* ---------- editor modal ---------- */

  function buildTypeOptions(selectedId) {
    typeOptions.innerHTML = '';
    TYPE_DEFS.forEach(function (t) {
      var opt = document.createElement('div');
      opt.className = 'type-option' + (t.id === selectedId ? ' selected' : '');
      opt.dataset.type = t.id;
      opt.innerHTML = '<span class="type-swatch" style="background:' + t.color + '"></span>' + t.label;
      opt.addEventListener('click', function () {
        Array.prototype.forEach.call(typeOptions.children, function (c) { c.classList.remove('selected'); });
        opt.classList.add('selected');
      });
      typeOptions.appendChild(opt);
    });
  }

  function onWellClick(ev) {
    var wellEl = ev.currentTarget;
    var key = wellKey(+wellEl.dataset.row, +wellEl.dataset.col);
    if (multiSelectMode) {
      toggleSelect(key);
      return;
    }
    clearSelection();
    openEditor(ev);
  }

  function openEditor(ev) {
    var wellEl = ev.currentTarget;
    var r = +wellEl.dataset.row, c = +wellEl.dataset.col;
    var key = wellKey(r, c);
    var data = getCurrent().wells[key] || {};
    batchMode = false;
    editingWell = { key: key };
    modalTitle.textContent = '标记孔位 ' + key;
    modalWellId.textContent = '第 ' + (r + 1) + ' 行 · 第 ' + (c + 1) + ' 列';
    document.getElementById('clearWellBtn').textContent = '清除标记';
    buildTypeOptions(data.type || TYPE_DEFS[0].id);
    wellNote.value = data.note || '';
    modalMask.classList.add('show');
    setTimeout(function () { wellNote.focus(); }, 50);
  }

  function closeModal() {
    modalMask.classList.remove('show');
    editingWell = null;
    batchMode = false;
  }

  function selectedType() {
    var typeEl = typeOptions.querySelector('.type-option.selected');
    return typeEl ? typeEl.dataset.type : TYPE_DEFS[0].id;
  }

  function saveWell() {
    if (batchMode) {
      var type = selectedType();
      var note = wellNote.value.trim();
      var wells = getCurrent().wells;
      Object.keys(selected).forEach(function (key) {
        if (note) wells[key] = { type: type, note: note };
        else wells[key] = { type: type };
      });
      savePlates();
      closeModal();
      clearSelection();
      renderAll();
      return;
    }
    if (!editingWell) return;
    var typeEl = typeOptions.querySelector('.type-option.selected');
    var type = typeEl ? typeEl.dataset.type : TYPE_DEFS[0].id;
    var note = wellNote.value.trim();
    var wells = getCurrent().wells;
    if (note) wells[editingWell.key] = { type: type, note: note };
    else if (wells[editingWell.key]) {
      if (wells[editingWell.key].type === type) delete wells[editingWell.key];
      else wells[editingWell.key] = { type: type };
    }
    savePlates();
    closeModal();
    renderAll();
  }

  function clearWell() {
    if (batchMode) {
      var wells = getCurrent().wells;
      Object.keys(selected).forEach(function (key) { delete wells[key]; });
      savePlates();
      closeModal();
      clearSelection();
      renderAll();
      return;
    }
    if (!editingWell) return;
    delete getCurrent().wells[editingWell.key];
    savePlates();
    closeModal();
    renderAll();
  }

  /* ---------- plate management ---------- */

  function addPlate() {
    var name = prompt('新实验板名称（如：qPCR 批次3）：', '新实验板 ' + (plates.length + 1));
    if (name === null || !name.trim()) return;
    var p = { id: 'p' + Date.now(), name: name.trim(), wells: {} };
    plates.push(p);
    currentId = p.id;
    savePlates();
    clearSelection();
    renderAll();
  }

  function clearCurrent() {
    if (!confirm('确定要清空「' + getCurrent().name + '」的所有标记吗？')) return;
    getCurrent().wells = {};
    savePlates();
    clearSelection();
    renderAll();
  }

  function exportCsv() {
    var wells = getCurrent().wells;
    var lines = ['孔位,类型,内容'];
    ROWS.split('').forEach(function (r) {
      for (var c = 1; c <= COLS; c++) {
        var key = r + c;
        var data = wells[key];
        if (data && data.type) {
          var note = (data.note || '').replace(/"/g, '""');
          lines.push(key + ',"' + typeById(data.type).label + '","' + note + '"');
        }
      }
    });
    if (lines.length === 1) lines.push('（本板暂无标记）');
    var blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = getCurrent().name.replace(/[\\/:*?"<>|]/g, '_') + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------- events ---------- */

  plateList.addEventListener('change', function () {
    currentId = plateList.value;
    clearSelection();
    renderAll();
  });

  searchInput.addEventListener('input', function () {
    applyWellStyles();
  });

  multiSelectBtn.addEventListener('click', function () {
    multiSelectMode = !multiSelectMode;
    multiSelectBtn.classList.toggle('active', multiSelectMode);
    if (!multiSelectMode) clearSelection();
    renderSelection();
  });

  batchEditBtn.addEventListener('click', openBatchEditor);
  batchClearBtn.addEventListener('click', function () {
    var wells = getCurrent().wells;
    selectedKeys().forEach(function (key) { delete wells[key]; });
    savePlates();
    clearSelection();
    renderAll();
  });
  clearSelectionBtn.addEventListener('click', clearSelection);

  plateEl.addEventListener('mousedown', onPlateMouseDown);

  document.getElementById('addPlateBtn').addEventListener('click', addPlate);
  document.getElementById('clearBtn').addEventListener('click', clearCurrent);
  document.getElementById('exportBtn').addEventListener('click', exportCsv);
  document.getElementById('modalSave').addEventListener('click', saveWell);
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('clearWellBtn').addEventListener('click', clearWell);
  modalMask.addEventListener('click', function (ev) {
    if (ev.target === modalMask) closeModal();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeModal();
  });

  renderAll();
})();