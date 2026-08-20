// AI生成
/* ===== bioassay.js — 主路由与公共工具 ===== */
(function () {
  "use strict";

  /* ---------- 模块切换 ---------- */
  var tabs = document.querySelectorAll(".module-tab");
  var panels = document.querySelectorAll(".module-panel");

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var mod = tab.dataset.module;
      tabs.forEach(function (t) { t.classList.remove("active"); });
      panels.forEach(function (p) { p.classList.remove("active"); });
      tab.classList.add("active");
      var panel = document.getElementById("module-" + mod);
      if (panel) panel.classList.add("active");
      // 切换后重绘当前模块图表
      if (window.__bioassayResize) window.__bioassayResize();
    });
  });

  /* ---------- 公共工具函数 ---------- */
  window.BioAssay = {
    /** 解析 "x, y" 每行一对的文本，返回 [{x, y}] */
    parsePairs: function (text) {
      var lines = text.trim().split("\n");
      var pairs = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        var parts = line.split(/[,;\t\s]+/).filter(function (p) { return p !== ""; });
        if (parts.length >= 2) {
          var x = parseFloat(parts[0]);
          var y = parseFloat(parts[1]);
          if (!isNaN(x) && !isNaN(y)) pairs.push({ x: x, y: y });
        }
      }
      return pairs;
    },

    /** 解析每行一个数值 */
    parseNumbers: function (text) {
      var lines = text.trim().split("\n");
      var nums = [];
      for (var i = 0; i < lines.length; i++) {
        var v = parseFloat(lines[i].trim());
        if (!isNaN(v)) nums.push(v);
      }
      return nums;
    },

    /** 均值 */
    mean: function (arr) {
      if (!arr.length) return 0;
      var s = 0;
      for (var i = 0; i < arr.length; i++) s += arr[i];
      return s / arr.length;
    },

    /** 标准差 (样本) */
    sd: function (arr) {
      if (arr.length < 2) return 0;
      var m = this.mean(arr);
      var ss = 0;
      for (var i = 0; i < arr.length; i++) ss += (arr[i] - m) * (arr[i] - m);
      return Math.sqrt(ss / (arr.length - 1));
    },

    /** 标准误 */
    sem: function (arr) {
      if (!arr.length) return 0;
      return this.sd(arr) / Math.sqrt(arr.length);
    },

    /** 变异系数 % */
    cv: function (arr) {
      var m = this.mean(arr);
      if (m === 0) return 0;
      return (this.sd(arr) / m) * 100;
    },

    /** 中位数 */
    median: function (arr) {
      var s = arr.slice().sort(function (a, b) { return a - b; });
      var n = s.length;
      if (n === 0) return 0;
      if (n % 2 === 1) return s[Math.floor(n / 2)];
      return (s[n / 2 - 1] + s[n / 2]) / 2;
    },

    /** 四分位数 */
    quantile: function (arr, q) {
      var s = arr.slice().sort(function (a, b) { return a - b; });
      var pos = (s.length - 1) * q;
      var base = Math.floor(pos);
      var rest = pos - base;
      if (s[base + 1] !== undefined) return s[base] + rest * (s[base + 1] - s[base]);
      return s[base];
    },

    /** R² 计算 */
    rSquared: function (actual, predicted) {
      var m = this.mean(actual);
      var ssRes = 0, ssTot = 0;
      for (var i = 0; i < actual.length; i++) {
        ssRes += (actual[i] - predicted[i]) * (actual[i] - predicted[i]);
        ssTot += (actual[i] - m) * (actual[i] - m);
      }
      return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
    },

    /** 创建结果表格 */
    table: function (headers, rows) {
      var html = '<table class="data-table"><thead><tr>';
      headers.forEach(function (h) { html += "<th>" + h + "</th>"; });
      html += "</tr></thead><tbody>";
      rows.forEach(function (r) {
        html += "<tr>";
        r.forEach(function (c) { html += "<td>" + c + "</td>"; });
        html += "</tr>";
      });
      html += "</tbody></table>";
      return html;
    },

    /** 格式化数字 */
    fmt: function (v, decimals) {
      if (decimals === undefined) decimals = 4;
      if (isNaN(v) || !isFinite(v)) return "—";
      if (Math.abs(v) < 0.0001 && v !== 0) return v.toExponential(3);
      return parseFloat(v.toFixed(decimals)).toString();
    },

    /** Chart.js 默认配置 */
    chartDefaults: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: "top", labels: { font: { size: 12 } } },
        tooltip: { intersect: false, mode: "nearest" }
      },
      scales: {
        x: { grid: { color: "rgba(0,0,0,0.06)" } },
        y: { grid: { color: "rgba(0,0,0,0.06)" } }
      }
    },

    /** 销毁旧图表 */
    destroyChart: function (id) {
      var el = document.getElementById(id);
      if (el && el.__chart) { el.__chart.destroy(); el.__chart = null; }
    },

    /** 渲染图表 */
    renderChart: function (id, config) {
      var el = document.getElementById(id);
      if (!el || typeof Chart === "undefined") return null;
      this.destroyChart(id);
      el.__chart = new Chart(el.getContext("2d"), config);
      return el.__chart;
    },

    /** 显示错误信息 */
    errorBox: function (msg) {
      return '<div class="notice notice-err">' + msg + "</div>";
    },

    /** 显示提示信息 */
    infoBox: function (msg) {
      return '<div class="notice">' + msg + "</div>";
    }
  };

  /* ---------- 窗口大小变化时重绘 ---------- */
  window.__bioassayResize = function () {
    document.querySelectorAll("canvas").forEach(function (el) {
      if (el.__chart) el.__chart.resize();
    });
  };
})();
