(function () {
  'use strict';

  /* ================= 常量 ================= */
  var ROWS = 'ABCDEFGH';
  var COLS = 12;
  var WELL_KEYS = (function () {
    var a = [];
    for (var i = 0; i < 8; i++) for (var j = 1; j <= 12; j++) a.push(ROWS[i] + j);
    return a;
  })();

  var UNITS = {
    h: { label: '小时', perHour: 1 },
    min: { label: '分钟', perHour: 60 },
    d: { label: '天', perHour: 1 / 24 }
  };

  var LINE_COLORS = [
    '#0e7a8a', '#d94f4f', '#e8a33d', '#4f81bd', '#5aa469', '#9b6bb0',
    '#c0504d', '#3a9b9f', '#8a6d3b', '#6b7bd9', '#d96b9b', '#4d9b6b'
  ];

  /* ================= 状态 ================= */
  var workbook = null;
  var fileName = '';
  var sheets = [];        // { name, grid, detect:{ok,data,anomalies,origin,transposed,multiple} }
  var timepoints = [];    // 解析后：{ name, timeHours, wells:{}, anomalies:[] }
  var globalMin = 0, globalMax = 1;
  var selected = {};      // { "A1": true, ... }
  var heatTimeIdx = 0;
  var lineChart = null;

  /* ================= DOM ================= */
  var $ = function (id) { return document.getElementById(id); };
  var fileInput = $('fileInput');
  var dropzone = $('dropzone');
  var importMsg = $('importMsg');
  var configPanel = $('configPanel');
  var previewPanel = $('previewPanel');
  var sheetTableBody = $('sheetTable').querySelector('tbody');
  var wavelength = $('wavelength');
  var timeUnit = $('timeUnit');
  var parseBtn = $('parseBtn');
  var summary = $('summary');
  var heatmapTimeSelect = $('heatmapTimeSelect');
  var heatmapCanvas = $('heatmapCanvas');
  var lineCanvas = $('lineCanvas');
  var lineHint = $('lineHint');
  var wellSelInfo = $('wellSelInfo');
  var wellGrid = $('wellGrid');
  var selectAllBtn = $('selectAllBtn');
  var clearSelBtn = $('clearSelBtn');
  var selectRowsBtn = $('selectRowsBtn');
  var selectColsBtn = $('selectColsBtn');
  var exportBtn = $('exportBtn');
  var exportMsg = $('exportMsg');

  /* ================= 工具函数 ================= */
  function wellKey(row, col) { return ROWS[row] + (col + 1); }

  function cellNorm(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/\s+/g, ' ').trim();
  }

  function fmt(x) {
    if (x === null || x === undefined || !isFinite(x)) return '';
    var s = String(Math.round(x * 10000) / 10000);
    return s;
  }

  function sanitizeSheetName(name, maxLen) {
    var s = String(name || '').replace(/[\[\]:*?/\\]/g, '_');
    if (s.length > (maxLen || 31)) s = s.slice(0, maxLen || 31);
    return s || 'Sheet';
  }

  function escapeXml(s) {
    return String(s).replace(/[<>&"]/g, function (c) {
      return c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;';
    });
  }

  /* ================= Excel 网格读取 ================= */
  function buildGrid(ws) {
    var ref = ws['!ref'];
    if (!ref) return [];
    var range = XLSX.utils.decode_range(ref);
    var rows = range.e.r - range.s.r + 1;
    var cols = range.e.c - range.s.c + 1;
    var grid = [];
    for (var r = 0; r < rows; r++) grid[r] = new Array(cols).fill(null);

    for (var R = range.s.r; R <= range.e.r; R++) {
      for (var C = range.s.c; C <= range.e.c; C++) {
        var cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        if (cell && cell.v !== undefined && cell.v !== null) {
          grid[R - range.s.r][C - range.s.c] = cell.v;
        }
      }
    }
    // 展开合并单元格（值只在左上角）
    (ws['!merges'] || []).forEach(function (m) {
      var v = grid[m.s.r - range.s.r] && grid[m.s.r - range.s.r][m.s.c - range.s.c];
      if (v === undefined || v === null) return;
      for (var R = m.s.r; R <= m.e.r; R++) {
        for (var C = m.s.c; C <= m.e.c; C++) {
          var rr = R - range.s.r, cc = C - range.s.c;
          if (rr >= 0 && cc >= 0 && rr < rows && cc < cols) grid[rr][cc] = v;
        }
      }
    });
    return grid;
  }

  /* ================= 8×12 矩阵自动识别 ================= */
  function findH(grid, seq) {
    var out = [];
    for (var r = 0; r < grid.length; r++) {
      var row = grid[r];
      if (!row) continue;
      for (var c = 0; c + seq.length <= row.length; c++) {
        var ok = true;
        for (var k = 0; k < seq.length; k++) {
          if (cellNorm(row[c + k]) !== seq[k]) { ok = false; break; }
        }
        if (ok) out.push({ row: r, col: c });
      }
    }
    return out;
  }

  function findV(grid, seq) {
    var out = [];
    var nrows = grid.length;
    var ncols = 0;
    for (var i = 0; i < nrows; i++) if (grid[i] && grid[i].length > ncols) ncols = grid[i].length;
    for (var c = 0; c < ncols; c++) {
      for (var r = 0; r + seq.length <= nrows; r++) {
        var ok = true;
        for (var k = 0; k < seq.length; k++) {
          if (cellNorm(grid[r + k] && grid[r + k][c]) !== seq[k]) { ok = false; break; }
        }
        if (ok) out.push({ row: r, col: c });
      }
    }
    return out;
  }

  function parseOD(v) {
    if (v === null || v === undefined) return { ok: false, reason: '空白' };
    if (typeof v === 'number') return isFinite(v) ? { ok: true, value: v } : { ok: false, reason: '非数值', raw: String(v) };
    var s = String(v).trim();
    if (s === '') return { ok: false, reason: '空白' };
    var n = Number(s);
    if (isFinite(n)) return { ok: true, value: n };
    // 欧洲小数逗号 "0,123"
    if (s.indexOf(',') !== -1 && s.indexOf('.') === -1) {
      var n2 = Number(s.replace(',', '.'));
      if (isFinite(n2)) return { ok: true, value: n2 };
    }
    return { ok: false, reason: '非数值', raw: s };
  }

  function extractGrid(grid, rowStart, colStart, transposed) {
    var data = [];
    var anomalies = [];
    for (var i = 0; i < 8; i++) {
      data[i] = [];
      for (var j = 0; j < 12; j++) {
        var rr = transposed ? (colStart + j) : (rowStart + i);
        var cc = transposed ? (rowStart + i) : (colStart + j);
        var cell = grid[rr] ? grid[rr][cc] : undefined;
        var r = parseOD(cell);
        if (r.ok) data[i][j] = r.value;
        else {
          data[i][j] = null;
          anomalies.push({ well: wellKey(i, j), reason: r.reason, raw: r.raw });
        }
      }
    }
    return { data: data, anomalies: anomalies };
  }

  function detectMatrix(grid) {
    if (!grid || !grid.length) return { ok: false, reason: '工作表为空' };
    var colSeq = [], rowSeq = [];
    for (var j = 1; j <= 12; j++) colSeq.push(String(j));
    for (var i = 0; i < 8; i++) rowSeq.push(ROWS[i]);

    var hCols = findH(grid, colSeq);   // 横排 1..12
    var vRows = findV(grid, rowSeq);   // 竖排 A..H
    if (hCols.length && vRows.length) {
      // 标准朝向：行 A–H / 列 1–12
      var extracted = extractGrid(grid, vRows[0].row, hCols[0].col, false);
      return {
        ok: true,
        data: extracted.data,
        anomalies: extracted.anomalies,
        origin: { row: vRows[0].row, col: hCols[0].col },
        transposed: false,
        multiple: (hCols.length + vRows.length) > 2
      };
    }

    var hRows = findH(grid, rowSeq);   // 横排 A..H
    var vCols = findV(grid, colSeq);   // 竖排 1..12
    if (hRows.length && vCols.length) {
      // 转置朝向：行 1–12 / 列 A–H
      var ex2 = extractGrid(grid, hRows[0].col, vCols[0].row, true);
      return {
        ok: true,
        data: ex2.data,
        anomalies: ex2.anomalies,
        origin: { row: hRows[0].row, col: hRows[0].col },
        transposed: true,
        multiple: (hRows.length + vCols.length) > 2
      };
    }

    return { ok: false, reason: '未找到 8×12 矩阵（缺少 A–H / 1–12 标签）' };
  }

  /* ================= 时间识别 ================= */
  function parseTime(name) {
    var s = String(name || '').trim();
    if (!s) return null;
    var m;
    if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)$/i))) return { hours: parseFloat(m[1]), inferred: false };
    if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:min|m|minute|minutes)$/i))) return { hours: parseFloat(m[1]) / 60, inferred: false };
    if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:d|day|days)$/i))) return { hours: parseFloat(m[1]) * 24, inferred: false };
    if ((m = s.match(/^(?:day|d)\s*(\d+(?:\.\d+)?)$/i))) return { hours: parseFloat(m[1]) * 24, inferred: false };
    if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) return { hours: parseFloat(m[1]), inferred: true };
    return null;
  }

  function unitKey() { return timeUnit.value || 'h'; }
  function unitLabel() { return UNITS[unitKey()].label; }
  function hoursToUnit(h) { return h * UNITS[unitKey()].perHour; }
  function unitToHours(v) { return v / UNITS[unitKey()].perHour; }

  /* ================= 导入 ================= */
  function handleFile(file) {
    if (!file) return;
    fileName = file.name;
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        readWorkbook(e.target.result);
      } catch (err) {
        showImportMsg('读取失败：' + (err && err.message ? err.message : err), true);
      }
    };
    reader.onerror = function () { showImportMsg('文件读取失败', true); };
    reader.readAsArrayBuffer(file);
  }

  function readWorkbook(arrayBuffer) {
    workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: false });
    var names = workbook.SheetNames;
    if (!names.length) { showImportMsg('工作簿里没有工作表', true); return; }

    sheets = names.map(function (name) {
      var grid = buildGrid(workbook.Sheets[name]);
      var detect = detectMatrix(grid);
      var t = parseTime(name);
      return {
        name: name,
        grid: grid,
        detect: detect,
        timeHours: t ? t.hours : null,
        timeInferred: t ? t.inferred : false
      };
    });

    importMsg.hidden = true;
    configPanel.hidden = false;
    previewPanel.hidden = true;
    renderSheetTable();
  }

  function showImportMsg(text, isErr) {
    importMsg.hidden = false;
    importMsg.textContent = text;
    importMsg.className = 'notice' + (isErr ? ' notice-err' : '');
  }

  /* ================= 工作表表格 ================= */
  function renderSheetTable() {
    sheetTableBody.innerHTML = '';
    sheets.forEach(function (sheet, idx) {
      var tr = document.createElement('tr');

      var tdName = document.createElement('td');
      tdName.textContent = sheet.name;
      tdName.title = sheet.name;

      var tdTime = document.createElement('td');
      var input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.className = 'time-input';
      input.value = sheet.timeHours === null ? '' : String(fmt(hoursToUnit(sheet.timeHours)));
      input.placeholder = '未识别';
      input.addEventListener('input', function () {
        var v = input.value.trim();
        sheet.timeHours = v === '' ? null : unitToHours(parseFloat(v));
      });
      tdTime.appendChild(input);
      var unitSpan = document.createElement('span');
      unitSpan.className = 'unit-inline';
      unitSpan.textContent = unitLabel();
      tdTime.appendChild(unitSpan);

      var tdStatus = document.createElement('td');
      if (!sheet.detect.ok) {
        tdStatus.textContent = '⚠ ' + sheet.detect.reason;
        tdStatus.className = 'status-warn';
      } else {
        var an = sheet.detect.anomalies.length;
        tdStatus.textContent = an === 0 ? '✓ 96 孔' : '⚠ 96 孔，异常 ' + an;
        tdStatus.className = an === 0 ? 'status-ok' : 'status-warn';
        if (sheet.detect.multiple) {
          tdStatus.textContent += '（检测到多个候选矩阵，已取第一个）';
        }
      }

      tr.appendChild(tdName);
      tr.appendChild(tdTime);
      tr.appendChild(tdStatus);
      sheetTableBody.appendChild(tr);
    });

    // 单位切换时刷新时间列显示
    var unitSpanLabel = document.querySelector('.unit-label');
    if (unitSpanLabel) unitSpanLabel.textContent = unitLabel();
  }

  /* ================= 解析 ================= */
  function doParse() {
    var list = [];
    var warnings = [];
    heatTimeIdx = 0;
    sheets.forEach(function (sheet) {
      if (!sheet.detect.ok) {
        warnings.push('工作表「' + sheet.name + '」：' + sheet.detect.reason + '，已跳过');
        return;
      }
      if (sheet.timeHours === null || !isFinite(sheet.timeHours)) {
        warnings.push('工作表「' + sheet.name + '」：时间未识别，请填写后重新解析');
        return;
      }
      var wells = {};
      var anomalies = [];
      for (var i = 0; i < 8; i++) {
        for (var j = 0; j < 12; j++) {
          var key = wellKey(i, j);
          var v = sheet.detect.data[i][j];
          if (v !== null) wells[key] = v;
        }
      }
      sheet.detect.anomalies.forEach(function (a) { anomalies.push(a); });
      list.push({ name: sheet.name, timeHours: sheet.timeHours, wells: wells, anomalies: anomalies });
    });

    list.sort(function (a, b) { return a.timeHours - b.timeHours; });
    timepoints = list;
    computeRange();

    renderSummary(warnings);
    renderHeatmapTimeSelect();
    renderWellGrid();
    renderHeatmapPreview();
    renderLineChart();
    configPanel.hidden = false;
    previewPanel.hidden = false;
    previewPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function computeRange() {
    var vals = [];
    timepoints.forEach(function (tp) {
      Object.keys(tp.wells).forEach(function (k) { vals.push(tp.wells[k]); });
    });
    if (!vals.length) { globalMin = 0; globalMax = 1; return; }
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi - lo < 1e-9) { lo = Math.min(0, lo); hi = hi + 0.05; if (hi <= lo) hi = lo + 0.1; }
    globalMin = lo; globalMax = hi;
  }

  /* ================= 摘要 ================= */
  function renderSummary(warnings) {
    var validCount = 0, anomalyCount = 0;
    timepoints.forEach(function (tp) {
      validCount += Object.keys(tp.wells).length;
      anomalyCount += tp.anomalies.length;
    });
    var html = '<span>时间点 <b>' + timepoints.length + '</b></span>' +
      '<span>有效读数 <b>' + validCount + '</b></span>' +
      '<span>异常 <b>' + anomalyCount + '</b></span>' +
      '<span>波长 <b>' + escapeXml(wavelength.value || '—') + ' nm</b></span>' +
      '<span>时间单位 <b>' + unitLabel() + '</b></span>';
    if (warnings.length) {
      html += '<ul class="summary-warn">' + warnings.map(function (w) {
        return '<li>' + escapeXml(w) + '</li>';
      }).join('') + '</ul>';
    }
    summary.innerHTML = html;
  }

  /* ================= 孔位选择网格 ================= */
  function renderWellGrid() {
    wellGrid.innerHTML = '';
    wellGrid.appendChild(makeLabel('', ''));
    for (var c = 0; c < COLS; c++) wellGrid.appendChild(makeLabel(String(c + 1), ''));
    var tp = timepoints[heatTimeIdx];
    for (var r = 0; r < ROWS.length; r++) {
      wellGrid.appendChild(makeLabel(ROWS[r], ''));
      for (var col = 0; col < COLS; col++) {
        var key = wellKey(r, col);
        var btn = document.createElement('button');
        btn.className = 'well';
        btn.dataset.key = key;
        btn.addEventListener('click', function () { toggleWell(this.dataset.key); });
        if (selected[key]) btn.classList.add('selected');
        if (tp) {
          var v = tp.wells[key];
          if (v !== undefined) {
            btn.classList.add('filled');
            btn.style.background = heatmapColor(v, globalMin, globalMax);
            btn.title = key + '：' + fmt(v);
          } else {
            btn.classList.add('anomaly');
            btn.title = key + '：异常';
          }
        }
        wellGrid.appendChild(btn);
      }
    }
    wellSelInfo.textContent = '已选 ' + selectedCount() + ' 个孔';
  }

  function makeLabel(text, cls) {
    var el = document.createElement('div');
    el.className = 'plate-label' + (cls ? ' ' + cls : '');
    el.textContent = text;
    return el;
  }

  function selectedCount() { return Object.keys(selected).length; }
  function selectedKeysSorted() {
    return WELL_KEYS.filter(function (k) { return selected[k]; });
  }

  function toggleWell(key) {
    if (selected[key]) delete selected[key];
    else selected[key] = true;
    renderWellGrid();
    renderLineChart();
  }

  function clearSelection() {
    selected = {};
    renderWellGrid();
    renderLineChart();
  }

  function selectAll() {
    WELL_KEYS.forEach(function (k) { selected[k] = true; });
    renderWellGrid();
    renderLineChart();
  }

  function selectRows() {
    var input = prompt('选择要加入的行（A–H，如 A 或 ABC）：', '');
    if (input === null) return;
    var picked = String(input).toUpperCase().replace(/[^A-H]/g, '');
    picked.split('').forEach(function (ch) {
      for (var j = 1; j <= 12; j++) selected[ch + j] = true;
    });
    renderWellGrid();
    renderLineChart();
  }

  function selectCols() {
    var input = prompt('选择要加入的列（1–12，如 1 或 1-6 或 1,3,5）：', '');
    if (input === null) return;
    var cols = parseColInput(input);
    cols.forEach(function (c) {
      for (var i = 0; i < 8; i++) selected[ROWS[i] + c] = true;
    });
    renderWellGrid();
    renderLineChart();
  }

  function parseColInput(input) {
    var out = [];
    String(input).split(/[,\s，]+/).forEach(function (part) {
      var range = part.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
      if (range) {
        var a = Math.min(+range[1], +range[2]), b = Math.max(+range[1], +range[2]);
        for (var n = a; n <= b; n++) if (n >= 1 && n <= 12) out.push(n);
      } else {
        var n = parseInt(part, 10);
        if (n >= 1 && n <= 12) out.push(n);
      }
    });
    // 去重
    var seen = {};
    return out.filter(function (n) { return seen[n] ? false : (seen[n] = true); });
  }

  /* ================= 色阶 ================= */
  function heatmapColor(v, min, max) {
    var t = (v - min) / (max - min);
    if (!isFinite(t)) t = 0.5;
    if (t < 0) t = 0; if (t > 1) t = 1;
    // 白 → 黄 → 红
    var stops = [
      { t: 0, rgb: [247, 251, 255] },
      { t: 0.5, rgb: [242, 201, 107] },
      { t: 1, rgb: [217, 79, 79] }
    ];
    var i = 0;
    while (i < stops.length - 2 && t > stops[i + 1].t) i++;
    var a = stops[i], b = stops[i + 1];
    var u = (t - a.t) / (b.t - a.t);
    var r = Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * u);
    var g = Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * u);
    var bl = Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * u);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  function hexFromRgbString(rgb) {
    var m = rgb.match(/rgb\((\d+),(\d+),(\d+)\)/);
    if (!m) return 'FFFFFFFF';
    var h = function (n) { var s = (+n).toString(16); return s.length === 1 ? '0' + s : s; };
    return 'FF' + h(m[1]) + h(m[2]) + h(m[3]);
  }

  function textColorFor(rgb) {
    var m = rgb.match(/rgb\((\d+),(\d+),(\d+)\)/);
    if (!m) return '#1d2b2a';
    var lum = 0.299 * (+m[1]) + 0.587 * (+m[2]) + 0.114 * (+m[3]);
    return lum > 170 ? '#1d2b2a' : '#ffffff';
  }

  /* ================= 热图绘制 ================= */
  function drawHeatmap(canvas, tp, min, max, cellSize) {
    cellSize = cellSize || 40;
    var mL = 30, mT = 22, mR = 10, mB = 10;
    var cellW = cellSize, cellH = cellSize;
    var W = mL + 12 * cellW + mR;
    var H = mT + 8 * cellH + mB;
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#5b6b69';
    var labelFont = 'bold ' + Math.round(cellSize * 0.28) + 'px sans-serif';
    ctx.font = labelFont;

    for (var j = 0; j < 12; j++) {
      ctx.fillText(String(j + 1), mL + j * cellW + cellW / 2, mT / 2 + 2);
    }
    ctx.textAlign = 'right';
    for (var i = 0; i < 8; i++) {
      ctx.fillText(ROWS[i], mL - 6, mT + i * cellH + cellH / 2);
    }

    var valueFont = Math.round(cellSize * 0.2) + 'px sans-serif';
    for (var i2 = 0; i2 < 8; i2++) {
      for (var j2 = 0; j2 < 12; j2++) {
        var x = mL + j2 * cellW, y = mT + i2 * cellH;
        var key = wellKey(i2, j2);
        var v = tp.wells[key];
        if (v !== undefined) {
          var color = heatmapColor(v, min, max);
          ctx.fillStyle = color;
          ctx.fillRect(x, y, cellW, cellH);
          ctx.fillStyle = textColorFor(color);
          ctx.font = valueFont;
          ctx.textAlign = 'center';
          ctx.fillText(v.toFixed(3), x + cellW / 2, y + cellH / 2);
        } else {
          ctx.fillStyle = '#f1f1f1';
          ctx.fillRect(x, y, cellW, cellH);
          ctx.fillStyle = '#b3b3b3';
          ctx.font = valueFont;
          ctx.textAlign = 'center';
          ctx.fillText('—', x + cellW / 2, y + cellH / 2);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
      }
    }
  }

  function renderHeatmapPreview() {
    if (!timepoints.length) return;
    var tp = timepoints[heatTimeIdx];
    drawHeatmap(heatmapCanvas, tp, globalMin, globalMax, 34);
  }

  function renderHeatmapTimeSelect() {
    heatmapTimeSelect.innerHTML = '';
    timepoints.forEach(function (tp, idx) {
      var opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = tp.name + '（' + fmt(hoursToUnit(tp.timeHours)) + ' ' + unitLabel() + '）';
      heatmapTimeSelect.appendChild(opt);
    });
    heatmapTimeSelect.value = String(heatTimeIdx);
  }

  /* ================= 折线图 ================= */
  function lineDatasets() {
    var keys = selectedKeysSorted();
    var labels = timepoints.map(function (tp) { return hoursToUnit(tp.timeHours); });
    var datasets = keys.map(function (key, idx) {
      var data = timepoints.map(function (tp) {
        var v = tp.wells[key];
        return v === undefined ? null : { x: hoursToUnit(tp.timeHours), y: v };
      });
      return {
        label: key,
        data: data,
        borderColor: LINE_COLORS[idx % LINE_COLORS.length],
        backgroundColor: LINE_COLORS[idx % LINE_COLORS.length],
        pointRadius: timepoints.length > 24 ? 1 : 2.5,
        pointHoverRadius: 5,
        borderWidth: 1.6,
        tension: 0.15,
        spanGaps: false
      };
    });
    return { labels: labels, datasets: datasets };
  }

  function renderLineChart() {
    var keys = selectedKeysSorted();
    if (!lineCanvas) return;
    if (lineChart) { lineChart.destroy(); lineChart = null; }

    if (!keys.length) {
      var c = lineCanvas.getContext('2d');
      lineCanvas.width = lineCanvas.clientWidth || 600;
      lineCanvas.height = lineCanvas.clientHeight || 340;
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, lineCanvas.width, lineCanvas.height);
      c.fillStyle = '#9aa7a5';
      c.font = '14px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('请在下方孔板中选择孔位', lineCanvas.width / 2, lineCanvas.height / 2);
      lineHint.hidden = false;
      return;
    }
    lineHint.hidden = true;

    var d = lineDatasets();
    var title = '选定孔位吸光度变化（' + (wavelength.value || '—') + ' nm）';
    lineChart = new Chart(lineCanvas, {
      type: 'line',
      data: d,
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { display: keys.length <= 24, position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } },
          title: { display: true, text: title, font: { size: 14 } }
        },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: '时间（' + unitLabel() + '）' },
            ticks: { maxTicksLimit: 12 }
          },
          y: {
            title: { display: true, text: '吸光度（OD）' },
            beginAtZero: false
          }
        }
      }
    });
  }

  /* ================= 导出 ================= */
  function renderHeatmapPng(tp, min, max) {
    var canvas = document.createElement('canvas');
    drawHeatmap(canvas, tp, min, max, 46);
    return canvas.toDataURL('image/png');
  }

  function renderLinePng() {
    var keys = selectedKeysSorted();
    if (!keys.length) return null;
    var canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 720;
    var d = lineDatasets();
    var title = '选定孔位吸光度变化（' + (wavelength.value || '—') + ' nm）';
    var chart = new Chart(canvas, {
      type: 'line',
      data: d,
      options: {
        animation: false,
        responsive: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 14, font: { size: 12 } } },
          title: { display: true, text: title, font: { size: 18 } }
        },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: '时间（' + unitLabel() + '）', font: { size: 14 } },
            ticks: { font: { size: 12 } }
          },
          y: {
            title: { display: true, text: '吸光度（OD）', font: { size: 14 } },
            ticks: { font: { size: 12 } }
          }
        }
      }
    });
    var url = canvas.toDataURL('image/png');
    chart.destroy();
    return url;
  }

  function exportWorkbook() {
    if (!timepoints.length) { exportMsg.textContent = '请先解析数据'; return; }
    var keys = selectedKeysSorted();
    exportBtn.disabled = true;
    exportMsg.textContent = '正在生成工作簿…';

    setTimeout(function () {
      try {
        var wb = new ExcelJS.Workbook();
        wb.creator = 'LabTools';
        wb.created = new Date();
        wb.modified = new Date();

        buildInfoSheet(wb);
        buildDetailSheet(wb);
        buildAnomalySheet(wb);
        timepoints.forEach(function (tp) { buildHeatmapSheet(wb, tp); });
        buildCurveSheet(wb, keys);

        wb.xlsx.writeBuffer().then(function (buffer) {
          var blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          var base = fileName.replace(/\.[^.]+$/, '') || '96孔板分析';
          a.download = base + '_分析.xlsx';
          a.click();
          URL.revokeObjectURL(a.href);
          exportMsg.textContent = '已导出';
        }).catch(function (err) {
          exportMsg.textContent = '导出失败：' + (err && err.message ? err.message : err);
        }).finally(function () { exportBtn.disabled = false; });
      } catch (err) {
        exportMsg.textContent = '导出失败：' + (err && err.message ? err.message : err);
        exportBtn.disabled = false;
      }
    }, 30);
  }

  function buildInfoSheet(wb) {
    var ws = wb.addWorksheet('实验信息');
    var validCount = 0, anomalyCount = 0;
    timepoints.forEach(function (tp) {
      validCount += Object.keys(tp.wells).length;
      anomalyCount += tp.anomalies.length;
    });
    var rows = [
      ['原始文件名', fileName],
      ['报告生成时间', new Date().toLocaleString()],
      ['检测波长（nm）', wavelength.value || ''],
      ['时间单位', unitLabel()],
      ['时间点数', timepoints.length],
      ['有效读数', validCount],
      ['异常读数', anomalyCount],
      [],
      ['工作表', '时间（' + unitLabel() + '）', '排序']
    ];
    timepoints.forEach(function (tp, idx) {
      rows.push([tp.name, fmt(hoursToUnit(tp.timeHours)), idx + 1]);
    });
    var anomalies = [];
    timepoints.forEach(function (tp) {
      tp.anomalies.forEach(function (a) { anomalies.push(tp.name + ' ' + a.well + '：' + a.reason + (a.raw !== undefined ? '（' + a.raw + '）' : '')); });
    });
    if (anomalies.length) {
      rows.push([]);
      rows.push(['解析备注']);
      anomalies.forEach(function (s) { rows.push(['', s]); });
    }
    rows.forEach(function (row, r) {
      row.forEach(function (cell, c) {
        var cc = ws.getCell(r + 1, c + 1);
        cc.value = cell;
        if (r === 0) { cc.font = { bold: true }; }
      });
    });
    ws.columns = [
      { width: 20 }, { width: 28 }, { width: 28 }
    ];
  }

  function buildDetailSheet(wb) {
    var ws = wb.addWorksheet('数据明细');
    var header = ['时间', '时间单位', '孔位', '吸光度（OD）', '来源工作表'];
    var row = ws.addRow(header);
    row.font = { bold: true };
    timepoints.forEach(function (tp) {
      WELL_KEYS.forEach(function (key) {
        if (tp.wells[key] !== undefined) {
          ws.addRow([hoursToUnit(tp.timeHours), unitLabel(), key, tp.wells[key], tp.name]);
        }
      });
    });
    ws.columns = [
      { width: 12 }, { width: 10 }, { width: 8 }, { width: 14 }, { width: 18 }
    ];
    ws.getColumn(4).numFmt = '0.0000';
  }

  function buildAnomalySheet(wb) {
    var ws = wb.addWorksheet('异常记录');
    var header = ['时间（' + unitLabel() + '）', '来源工作表', '孔位', '原因', '原始内容'];
    var row = ws.addRow(header);
    row.font = { bold: true };
    var has = false;
    timepoints.forEach(function (tp) {
      tp.anomalies.forEach(function (a) {
        has = true;
        ws.addRow([hoursToUnit(tp.timeHours), tp.name, a.well, a.reason, a.raw !== undefined ? a.raw : '']);
      });
    });
    if (!has) ws.addRow(['（无异常）', '', '', '', '']);
    ws.columns = [
      { width: 14 }, { width: 16 }, { width: 8 }, { width: 12 }, { width: 20 }
    ];
  }

  function buildHeatmapSheet(wb, tp) {
    var ws = wb.addWorksheet(sanitizeSheetName('热图 ' + tp.name));
    ws.getCell('A1').value = '热图 ' + tp.name + '（吸光度 OD）';
    ws.getCell('A1').font = { bold: true, size: 13 };
    // 表头
    for (var j = 0; j < 12; j++) {
      var hc = ws.getCell(2, 2 + j);
      hc.value = j + 1;
      hc.font = { bold: true };
      hc.alignment = { horizontal: 'center' };
    }
    for (var i = 0; i < 8; i++) {
      var rc = ws.getCell(3 + i, 1);
      rc.value = ROWS[i];
      rc.font = { bold: true };
      rc.alignment = { horizontal: 'center' };
      for (var j2 = 0; j2 < 12; j2++) {
        var key = wellKey(i, j2);
        var cell = ws.getCell(3 + i, 2 + j2);
        cell.value = tp.wells[key] !== undefined ? tp.wells[key] : null;
        cell.numFmt = '0.000';
        cell.alignment = { horizontal: 'center' };
      }
    }
    ws.addConditionalFormatting({
      ref: 'B3:M10',
      rules: [{
        type: 'colorScale',
        priority: 1,
        cfvo: [
          { type: 'min' },
          { type: 'percentile', value: 50 },
          { type: 'max' }
        ],
        color: [
          { argb: 'FFF7FBFF' },
          { argb: 'FFF2C96B' },
          { argb: 'FFD94F4F' }
        ]
      }]
    });
    // 嵌入 PNG 热图
    var dataUrl = renderHeatmapPng(tp, globalMin, globalMax);
    var imageId = wb.addImage({ base64: dataUrl.split(',')[1], extension: 'png' });
    ws.addImage(imageId, {
      tl: { col: 14, row: 1 },
      ext: { width: 480, height: 320 }
    });
    ws.getColumn(1).width = 6;
    for (var j3 = 1; j3 <= 12; j3++) ws.getColumn(1 + j3).width = 7;
  }

  function buildCurveSheet(wb, keys) {
    var ws = wb.addWorksheet('变化曲线');
    ws.getCell('A1').value = '选定孔位吸光度变化（' + (wavelength.value || '—') + ' nm）';
    ws.getCell('A1').font = { bold: true, size: 13 };

    if (!keys.length) {
      ws.getCell('A3').value = '未选择孔位，无法生成变化曲线。';
      return;
    }

    var png = renderLinePng();
    if (png) {
      var imageId = wb.addImage({ base64: png.split(',')[1], extension: 'png' });
      ws.addImage(imageId, {
        tl: { col: 0, row: 2 },
        ext: { width: 780, height: 470 }
      });
    }

    // 数据表（放在图下方：图约占 470/20 ≈ 24 行高，从 27 行开始）
    var startRow = 27;
    var headerRow = ws.getRow(startRow);
    headerRow.getCell(1).value = '时间（' + unitLabel() + '）';
    headerRow.getCell(1).font = { bold: true };
    keys.forEach(function (key, idx) {
      var c = headerRow.getCell(2 + idx);
      c.value = key;
      c.font = { bold: true };
    });
    timepoints.forEach(function (tp, r) {
      var row = ws.getRow(startRow + 1 + r);
      row.getCell(1).value = hoursToUnit(tp.timeHours);
      keys.forEach(function (key, idx) {
        var v = tp.wells[key];
        row.getCell(2 + idx).value = v !== undefined ? v : null;
        row.getCell(2 + idx).numFmt = '0.000';
      });
    });
  }

  /* ================= 事件 ================= */
  dropzone.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () { handleFile(fileInput.files[0]); });
  dropzone.addEventListener('dragover', function (ev) {
    ev.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', function () { dropzone.classList.remove('dragover'); });
  dropzone.addEventListener('drop', function (ev) {
    ev.preventDefault();
    dropzone.classList.remove('dragover');
    if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]) {
      handleFile(ev.dataTransfer.files[0]);
    }
  });

  timeUnit.addEventListener('change', function () {
    renderSheetTable();
    if (timepoints.length) {
      renderSummary([]);
      renderHeatmapTimeSelect();
      renderHeatmapPreview();
      renderLineChart();
    }
  });

  parseBtn.addEventListener('click', doParse);

  heatmapTimeSelect.addEventListener('change', function () {
    heatTimeIdx = parseInt(heatmapTimeSelect.value, 10) || 0;
    renderWellGrid();
    renderHeatmapPreview();
  });

  selectAllBtn.addEventListener('click', selectAll);
  clearSelBtn.addEventListener('click', clearSelection);
  selectRowsBtn.addEventListener('click', selectRows);
  selectColsBtn.addEventListener('click', selectCols);
  exportBtn.addEventListener('click', exportWorkbook);
})();
