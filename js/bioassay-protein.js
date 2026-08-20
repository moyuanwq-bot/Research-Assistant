// AI生成
/**
 * bioassay-protein.js — 蛋白浓度测定模块
 *
 * 依赖（全局）：
 *   Chart    — Chart.js 图表库
 *   BioAssay — 辅助对象，提供以下方法：
 *     parsePairs(text)        解析"浓度,吸光度"文本对，返回 [{x,y}, ...]
 *     parseNumbers(text)      解析纯数字文本，返回 [n, ...]
 *     mean(arr) / rSquared(actual, predicted)
 *     table(headers, rows)    生成 HTML 表格字符串
 *     fmt(v, decimals)        数字格式化
 *     chartDefaults           图表默认配置
 *     destroyChart(id) / renderChart(id, config)
 *     errorBox(msg) / infoBox(msg)
 *
 * 测定方法：
 *   bca      — BCA 法 (A562)，标准曲线线性回归
 *   bradford — Bradford 法 (A595)，标准曲线线性回归
 *   uv280    — UV 吸收法 (A280)，基于消光系数直接计算
 */
(function () {
    'use strict';

    /* ============================================================
     * DOM 元素引用
     * ============================================================ */
    var els = {
        method:      document.getElementById('proteinMethod'),
        stdSection:  document.getElementById('proteinStdSection'),
        stdData:     document.getElementById('proteinStdData'),
        uvSection:   document.getElementById('proteinUVSection'),
        uvType:      document.getElementById('proteinUVType'),
        epsilon:     document.getElementById('proteinEpsilon'),
        mw:          document.getElementById('proteinMW'),
        epsField:    document.getElementById('proteinEpsField'),
        sampleData:  document.getElementById('proteinSampleData'),
        calcBtn:     document.getElementById('proteinCalcBtn'),
        clearBtn:    document.getElementById('proteinClearBtn'),
        chart:       document.getElementById('proteinChart'),
        chartBlock:  document.getElementById('proteinChartBlock'),
        result:      document.getElementById('proteinResult')
    };

    /* ============================================================
     * 常量数据
     * ============================================================ */

    /* 预设蛋白消光系数 (M⁻¹cm⁻¹) 与分子量 (Da) */
    var PROTEIN_PRESETS = {
        bsa:       { epsilon: 43824,  mw: 66430  },
        igg:       { epsilon: 210000, mw: 150000 },
        lysozyme:  { epsilon: 37890,  mw: 14300  },
        ovalbumin: { epsilon: 30100,  mw: 42700  }
    };

    /* 比色皿光程 (cm)，标准 1 cm */
    var PATHLENGTH = 1;

    /* 品牌色 —— 拟合线 */
    var BRAND = '#087f89';
    /* 数据点颜色 */
    var DOT_COLOR = 'rgba(54, 108, 235, 0.7)';
    var DOT_BORDER = 'rgba(54, 108, 235, 1)';

    /* ============================================================
     * 通用辅助函数
     * ============================================================ */

    /**
     * 线性回归 y = ax + b（最小二乘法）
     * @param {Array} xs  自变量数组（浓度）
     * @param {Array} ys  因变量数组（吸光度）
     * @returns {{a:number, b:number, r2:number,
     *            predict:Function, inverse:Function, equation:string}|null}
     */
    function fitLinear(xs, ys) {
        var n = xs.length;
        var mx = BioAssay.mean(xs);
        var my = BioAssay.mean(ys);

        var num = 0, den = 0;
        for (var i = 0; i < n; i++) {
            num += (xs[i] - mx) * (ys[i] - my);
            den += (xs[i] - mx) * (xs[i] - mx);
        }
        if (Math.abs(den) < 1e-15) return null;

        var a = num / den;
        var b = my - a * mx;

        var predicted = xs.map(function (x) { return a * x + b; });
        var r2 = BioAssay.rSquared(ys, predicted);

        return {
            a: a, b: b, r2: r2,
            predict: function (x) { return a * x + b; },
            inverse:  function (y) { return (y - b) / a; },
            equation: 'y = ' + BioAssay.fmt(a, 6) + 'x + ' + BioAssay.fmt(b, 6)
        };
    }

    /* ============================================================
     * 界面切换
     * ============================================================ */

    /**
     * 测定方法切换
     * BCA/Bradford → 显示标准品区、隐藏 UV 区、显示图表区
     * UV280       → 隐藏标准品区、显示 UV 区、隐藏图表区
     */
    function onMethodChange() {
        var method = els.method.value;
        var isUV = (method === 'uv280');

        /* 标准品输入区：仅 BCA/Bradford 需要 */
        els.stdSection.hidden = isUV;
        /* UV280 专属输入区 */
        els.uvSection.hidden = !isUV;
        /* 标准曲线图表：仅 BCA/Bradford 需要 */
        els.chartBlock.hidden = isUV;

        /* 切换方法时清空已有结果与图表 */
        els.result.innerHTML = '';
        BioAssay.destroyChart('proteinChart');
    }

    /**
     * UV280 蛋白类型切换
     * 预设蛋白 → 自动填充消光系数与分子量，隐藏消光系数输入框
     * 自定义   → 显示消光系数输入框，由用户手动输入
     */
    function onUVTypeChange() {
        var type = els.uvType.value;
        var preset = PROTEIN_PRESETS[type];

        if (preset) {
            /* 预设蛋白：自动填充并隐藏消光系数输入 */
            els.epsilon.value = String(preset.epsilon);
            els.mw.value = String(preset.mw);
            els.epsField.hidden = true;
        } else {
            /* 自定义：显示消光系数输入框 */
            els.epsField.hidden = false;
        }
    }

    /* ============================================================
     * BCA / Bradford 计算
     * ============================================================ */

    /**
     * 渲染标准曲线图表（散点 + 拟合直线）
     * @param {Array}  stdPoints  标准品散点 [{x,y}, ...]（x=浓度, y=吸光度）
     * @param {Object} fit        线性拟合结果
     */
    function renderStdCurveChart(stdPoints, fit) {
        /* 生成拟合直线（覆盖数据范围并适当延伸） */
        var xMin = Math.min.apply(null, stdPoints.map(function (p) { return p.x; }));
        var xMax = Math.max.apply(null, stdPoints.map(function (p) { return p.x; }));
        var pad = (xMax - xMin) * 0.1 || 1;
        var linePoints = [
            { x: xMin - pad, y: fit.predict(xMin - pad) },
            { x: xMax + pad, y: fit.predict(xMax + pad) }
        ];

        var datasets = [
            {
                label: '标准品',
                data: stdPoints,
                backgroundColor: DOT_COLOR,
                borderColor: DOT_BORDER,
                pointRadius: 5,
                pointStyle: 'circle',
                showLine: false
            },
            {
                label: '拟合直线',
                data: linePoints,
                borderColor: BRAND,
                backgroundColor: BRAND,
                borderWidth: 2,
                pointRadius: 0,
                showLine: true,
                tension: 0
            }
        ];

        var opts = Object.assign({}, BioAssay.chartDefaults, {
            scales: {
                x: { type: 'linear', title: { display: true, text: '浓度 (μg/mL)' } },
                y: { type: 'linear', title: { display: true, text: '吸光度' } }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (ctx) {
                            return ctx.dataset.label + ': (' +
                                   BioAssay.fmt(ctx.parsed.x, 4) + ', ' +
                                   BioAssay.fmt(ctx.parsed.y, 4) + ')';
                        }
                    }
                }
            }
        });

        BioAssay.renderChart('proteinChart', {
            type: 'scatter',
            data: { datasets: datasets },
            options: opts
        });
    }

    /**
     * 执行 BCA/Bradford 法浓度计算
     * 标准曲线线性回归：y(吸光度) = a·x(浓度) + b
     * 反算浓度：conc = (A − b) / a
     * @param {string} methodName 方法显示名称（BCA / Bradford）
     */
    function doStandardCurve(methodName) {
        /* ---- 解析标准品数据 ---- */
        var stdText = els.stdData.value.trim();
        if (!stdText) {
            els.result.innerHTML = BioAssay.errorBox('请输入标准品数据');
            return;
        }

        var stdPairs = BioAssay.parsePairs(stdText);
        if (!stdPairs || stdPairs.length < 2) {
            els.result.innerHTML = BioAssay.errorBox('标准品数据至少需要 2 个数据点');
            return;
        }

        /* 浓度为 x，吸光度为 y */
        var xs = stdPairs.map(function (p) { return p.x; });
        var ys = stdPairs.map(function (p) { return p.y; });

        /* ---- 线性回归拟合 ---- */
        var fit = fitLinear(xs, ys);
        if (!fit) {
            els.result.innerHTML = BioAssay.errorBox('线性拟合失败，请检查标准品数据是否合理');
            return;
        }

        /* ---- 解析样品吸光度并反算浓度 ---- */
        var sampleText = els.sampleData.value.trim();
        if (!sampleText) {
            els.result.innerHTML = BioAssay.errorBox('请输入样品吸光度值');
            return;
        }

        var sampleODs = BioAssay.parseNumbers(sampleText);
        if (!sampleODs.length) {
            els.result.innerHTML = BioAssay.errorBox('未能解析出有效的样品吸光度值');
            return;
        }

        var samples = sampleODs.map(function (od) {
            return { od: od, conc: fit.inverse(od) };
        });

        /* ---- 渲染标准曲线图表 ---- */
        var stdPoints = stdPairs.map(function (p) { return { x: p.x, y: p.y }; });
        renderStdCurveChart(stdPoints, fit);

        /* ---- 渲染结果 ---- */
        var html = '';

        /* 拟合参数表 */
        html += '<h4>标准曲线拟合参数</h4>';
        html += BioAssay.table(
            ['参数', '值', '说明'],
            [
                ['斜率 (a)', BioAssay.fmt(fit.a, 6), '灵敏度'],
                ['截距 (b)', BioAssay.fmt(fit.b, 6), '空白对照'],
                ['R²',       BioAssay.fmt(fit.r2, 6), '决定系数'],
                ['方程',     fit.equation,           '浓度 = (A − b) / a']
            ]
        );

        /* 样品结果表 */
        html += '<h4>样品浓度计算结果</h4>';
        var rows = samples.map(function (s, i) {
            return [
                String(i + 1),
                BioAssay.fmt(s.od, 4),
                isFinite(s.conc) ? BioAssay.fmt(s.conc, 4) : 'N/A'
            ];
        });
        html += BioAssay.table(['序号', '吸光度', '浓度 (μg/mL)'], rows);

        /* 方法说明 */
        html += BioAssay.infoBox(
            methodName + ' 法：以标准品浓度对吸光度进行线性回归，' +
            '通过拟合方程反算未知样品浓度。'
        );

        els.result.innerHTML = html;
    }

    /* ============================================================
     * UV280 (A280) 计算
     * ============================================================ */

    /**
     * 执行 UV280 法浓度计算
     * 基于 Beer-Lambert 定律：A = ε · c · l
     *   c (M)     = A280 / (ε · l)
     *   c (mg/mL) = c (M) · MW / 1000
     *   c (μM)    = c (M) · 10⁶
     */
    function doUV280() {
        /* ---- 获取消光系数与分子量 ---- */
        var epsilon = parseFloat(els.epsilon.value);
        var mw = parseFloat(els.mw.value);

        if (isNaN(epsilon) || epsilon <= 0) {
            els.result.innerHTML = BioAssay.errorBox('请输入有效的消光系数（正数）');
            return;
        }
        if (isNaN(mw) || mw <= 0) {
            els.result.innerHTML = BioAssay.errorBox('请输入有效的分子量（正数）');
            return;
        }

        /* ---- 解析样品 A280 值 ---- */
        var sampleText = els.sampleData.value.trim();
        if (!sampleText) {
            els.result.innerHTML = BioAssay.errorBox('请输入样品 A280 吸光度值');
            return;
        }

        var a280s = BioAssay.parseNumbers(sampleText);
        if (!a280s.length) {
            els.result.innerHTML = BioAssay.errorBox('未能解析出有效的 A280 值');
            return;
        }

        /* ---- 逐个计算浓度 ---- */
        var samples = a280s.map(function (a280) {
            var concM   = a280 / (epsilon * PATHLENGTH);   /* 浓度 (mol/L) */
            var concMg  = concM * mw / 1000;                /* 浓度 (mg/mL) */
            var concUuM = concM * 1e6;                       /* 浓度 (μM) */
            return { a280: a280, concMg: concMg, concUuM: concUuM };
        });

        /* ---- 渲染结果 ---- */
        var html = '';

        /* 计算参数表 */
        html += '<h4>计算参数</h4>';
        html += BioAssay.table(
            ['参数', '值', '说明'],
            [
                ['消光系数 ε', BioAssay.fmt(epsilon, 2),    'M⁻¹cm⁻¹'],
                ['分子量 MW',  BioAssay.fmt(mw, 2),         'Da'],
                ['光程',       BioAssay.fmt(PATHLENGTH, 2), 'cm']
            ]
        );

        /* 样品结果表 */
        html += '<h4>样品浓度计算结果</h4>';
        var rows = samples.map(function (s, i) {
            return [
                String(i + 1),
                BioAssay.fmt(s.a280, 4),
                BioAssay.fmt(s.concMg, 4),
                BioAssay.fmt(s.concUuM, 4)
            ];
        });
        html += BioAssay.table(
            ['序号', 'A280', '浓度 (mg/mL)', '浓度 (μM)'],
            rows
        );

        /* 方法说明 */
        html += BioAssay.infoBox(
            'UV 吸收法 (A280)：基于 Beer-Lambert 定律 A = ε·c·l，' +
            '浓度 c = A280 / (ε × l)，再由分子量换算为 mg/mL 与 μM。'
        );

        els.result.innerHTML = html;
    }

    /* ============================================================
     * 主流程
     * ============================================================ */

    /** 执行蛋白浓度计算 */
    function doCalc() {
        var method = els.method.value;

        if (method === 'uv280') {
            doUV280();
        } else if (method === 'bca') {
            doStandardCurve('BCA');
        } else {
            doStandardCurve('Bradford');
        }
    }

    /** 清空所有输入与结果 */
    function doClear() {
        els.stdData.value = '';
        els.sampleData.value = '';
        els.result.innerHTML = '';
        BioAssay.destroyChart('proteinChart');
    }

    /* ============================================================
     * 事件绑定
     * ============================================================ */
    if (els.method)    els.method.addEventListener('change', onMethodChange);
    if (els.uvType)    els.uvType.addEventListener('change', onUVTypeChange);
    if (els.calcBtn)   els.calcBtn.addEventListener('click', doCalc);
    if (els.clearBtn)  els.clearBtn.addEventListener('click', doClear);

})();
