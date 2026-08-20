// AI生成
/**
 * bioassay-kinetics.js — 酶动力学分析模块
 *
 * 依赖（全局）：
 *   Chart    — Chart.js 图表库
 *   BioAssay — 辅助对象，提供以下方法：
 *     parsePairs(text)                  解析"[S],V"文本对，返回 [{x,y}, ...]
 *     rSquared(actual, predicted)       计算 R²
 *     table(headers, rows)              生成 HTML 表格字符串
 *     fmt(v, decimals)                  数字格式化
 *     chartDefaults                     图表默认配置
 *     destroyChart(id) / renderChart(id, config)
 *     errorBox(msg) / infoBox(msg)
 *
 * 分析方法：
 *   mm — Michaelis-Menten 直接拟合  V = Vmax·[S] / (Km + [S])
 *   lb — Lineweaver-Burk 双倒数     1/V = (Km/Vmax)·(1/[S]) + 1/Vmax
 *   eh — Eadie-Hofstee 作图         V = Vmax − Km·(V/[S])
 */
(function () {
    'use strict';

    /* ============================================================
     * DOM 元素引用
     * ============================================================ */
    var els = {
        plotType:   document.getElementById('kineticsPlotType'),
        data:       document.getElementById('kineticsData'),
        enzConc:    document.getElementById('kineticsEnzConc'),
        fitBtn:     document.getElementById('kineticsFitBtn'),
        clearBtn:   document.getElementById('kineticsClearBtn'),
        chart:      document.getElementById('kineticsChart'),
        chartTitle: document.getElementById('kineticsChartTitle'),
        result:     document.getElementById('kineticsResult')
    };

    /* 品牌色 —— 拟合线 / 曲线 */
    var BRAND = '#087f89';
    /* 数据点颜色 */
    var DOT_COLOR = 'rgba(54, 108, 235, 0.7)';
    var DOT_BORDER = 'rgba(54, 108, 235, 1)';

    /* 各作图方式对应的标题 */
    var TITLES = {
        mm: 'Michaelis-Menten 曲线拟合',
        lb: 'Lineweaver-Burk 双倒数图',
        eh: 'Eadie-Hofstee 图'
    };

    /* ============================================================
     * 通用辅助函数
     * ============================================================ */

    /**
     * 线性回归 y = ax + b（最小二乘法）
     * @param {Array} xs  自变量数组
     * @param {Array} ys  因变量数组
     * @returns {{a:number, b:number, r2:number, predict:Function}|null}
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
            predict: function (x) { return a * x + b; }
        };
    }

    /**
     * 用 Michaelis-Menten 方程计算预测速率
     * V = Vmax * [S] / (Km + [S])
     */
    function mmPredict(S, Km, Vmax) {
        return Vmax * S / (Km + S);
    }

    /**
     * 计算原始 V 数据上的 R²（用 MM 方程预测）
     * 三种方法统一使用此函数，便于公平比较
     */
    function rSquaredOnV(S, V, Km, Vmax) {
        var predicted = S.map(function (s) { return mmPredict(s, Km, Vmax); });
        return BioAssay.rSquared(V, predicted);
    }

    /* ============================================================
     * 拟合算法
     * ============================================================ */

    /**
     * 1. Michaelis-Menten 直接拟合
     *    V = Vmax · [S] / (Km + [S])
     *    非线性最小二乘，梯度下降 + 自适应学习率
     *
     *    残差 r_i = V_i − Vmax·S_i / (Km + S_i)
     *    ∂SSE/∂Vmax = −2 · Σ r_i · S_i / (Km + S_i)
     *    ∂SSE/∂Km   =  2 · Vmax · Σ r_i · S_i / (Km + S_i)²
     *
     * @param {Array} S  底物浓度数组
     * @param {Array} V  反应速率数组
     * @returns {{Km:number, Vmax:number, r2:number, equation:string}}
     */
    function fitMichaelisMenten(S, V) {
        var n = S.length;

        /* ---- 初始估计 ---- */
        var Vmax = Math.max.apply(null, V);
        var halfMax = Vmax / 2;
        /* Km 取最接近 Vmax/2 处的 [S] */
        var Km = S[0];
        var minDiff = Math.abs(V[0] - halfMax);
        for (var i = 1; i < n; i++) {
            var diff = Math.abs(V[i] - halfMax);
            if (diff < minDiff) {
                minDiff = diff;
                Km = S[i];
            }
        }
        if (Km <= 0) Km = 1;                 /* 保证 Km 为正 */

        /* ---- 梯度下降主循环 ---- */
        var lr = 0.0001;                      /* 初始学习率 */
        var maxIter = 20000;
        var tol = 1e-14;
        var prevSSE = Infinity;

        for (var iter = 0; iter < maxIter; iter++) {
            /* 计算残差、梯度与当前 SSE */
            var gradVmax = 0, gradKm = 0, sse = 0;
            for (var i = 0; i < n; i++) {
                var denom = Km + S[i];
                var f = Vmax * S[i] / denom;
                var resid = V[i] - f;
                sse += resid * resid;
                gradVmax += -2 * resid * S[i] / denom;
                gradKm += 2 * Vmax * resid * S[i] / (denom * denom);
            }

            /* 收敛判断 */
            if (Math.abs(prevSSE - sse) < tol) break;
            prevSSE = sse;

            /* 自适应步长：尝试更新，若 SSE 下降则接受并加大步长，否则缩小 */
            var trialLr = lr;
            var improved = false;
            for (var attempt = 0; attempt < 25; attempt++) {
                var newVmax = Vmax - trialLr * gradVmax;
                var newKm = Km - trialLr * gradKm;
                /* 保证参数为正 */
                if (newVmax <= 0) newVmax = Vmax * 0.1;
                if (newKm <= 0) newKm = Km * 0.1;

                var newSSE = 0;
                for (var i = 0; i < n; i++) {
                    var f = newVmax * S[i] / (newKm + S[i]);
                    newSSE += (V[i] - f) * (V[i] - f);
                }

                if (newSSE < sse) {
                    Vmax = newVmax;
                    Km = newKm;
                    lr = trialLr * 1.2;       /* 加大步长 */
                    improved = true;
                    break;
                }
                trialLr *= 0.5;               /* 缩小步长重试 */
            }

            if (!improved) {
                lr *= 0.1;
                if (lr < 1e-18) break;        /* 学习率过小，退出 */
            }
        }

        var r2 = rSquaredOnV(S, V, Km, Vmax);

        return {
            Km: Km,
            Vmax: Vmax,
            r2: r2,
            equation: 'V = ' + BioAssay.fmt(Vmax, 4) +
                      ' · [S] / (' + BioAssay.fmt(Km, 4) + ' + [S])'
        };
    }

    /**
     * 2. Lineweaver-Burk 双倒数线性化
     *    1/V = (Km/Vmax) · (1/[S]) + 1/Vmax
     *    令 x = 1/[S]，y = 1/V，线性回归 y = a·x + b
     *    斜率 a = Km/Vmax，截距 b = 1/Vmax
     *    → Vmax = 1/b，Km = a · Vmax
     *
     * @param {Array} S  底物浓度数组
     * @param {Array} V  反应速率数组
     * @returns {{Km:number, Vmax:number, r2:number, equation:string,
     *            tx:Array, ty:Array, a:number, b:number}|null}
     */
    function fitLineweaverBurk(S, V) {
        var n = S.length;

        /* 变换数据：x = 1/[S]，y = 1/V */
        var tx = [], ty = [];
        for (var i = 0; i < n; i++) {
            if (S[i] === 0 || V[i] === 0) return null;   /* 无法取倒数 */
            tx.push(1 / S[i]);
            ty.push(1 / V[i]);
        }

        var fit = fitLinear(tx, ty);
        if (!fit) return null;

        var slope = fit.a;       /* Km / Vmax */
        var intercept = fit.b;   /* 1 / Vmax */
        if (Math.abs(intercept) < 1e-15) return null;

        var Vmax = 1 / intercept;
        var Km = slope * Vmax;

        /* R² 统一在原始 V 数据上计算 */
        var r2 = rSquaredOnV(S, V, Km, Vmax);

        return {
            Km: Km,
            Vmax: Vmax,
            r2: r2,
            a: slope,
            b: intercept,
            tx: tx,
            ty: ty,
            equation: '1/V = ' + BioAssay.fmt(slope, 4) +
                      ' · 1/[S] + ' + BioAssay.fmt(intercept, 4)
        };
    }

    /**
     * 3. Eadie-Hofstee 线性化作图
     *    V = Vmax − Km · (V/[S])
     *    令 x = V/[S]，y = V，线性回归 y = a·x + b
     *    斜率 a = −Km，截距 b = Vmax
     *    → Vmax = b，Km = −a
     *
     * @param {Array} S  底物浓度数组
     * @param {Array} V  反应速率数组
     * @returns {{Km:number, Vmax:number, r2:number, equation:string,
     *            tx:Array, ty:Array, a:number, b:number}|null}
     */
    function fitEadieHofstee(S, V) {
        var n = S.length;

        /* 变换数据：x = V/[S]，y = V */
        var tx = [], ty = [];
        for (var i = 0; i < n; i++) {
            if (S[i] === 0) return null;       /* 除零保护 */
            tx.push(V[i] / S[i]);
            ty.push(V[i]);
        }

        var fit = fitLinear(tx, ty);
        if (!fit) return null;

        var slope = fit.a;       /* −Km */
        var intercept = fit.b;   /* Vmax */

        var Vmax = intercept;
        var Km = -slope;

        /* R² 统一在原始 V 数据上计算 */
        var r2 = rSquaredOnV(S, V, Km, Vmax);

        return {
            Km: Km,
            Vmax: Vmax,
            r2: r2,
            a: slope,
            b: intercept,
            tx: tx,
            ty: ty,
            equation: 'V = ' + BioAssay.fmt(Vmax, 4) +
                      ' − ' + BioAssay.fmt(Km, 4) + ' · V/[S]'
        };
    }

    /* ============================================================
     * 图表渲染
     * ============================================================ */

    /**
     * 渲染 Michaelis-Menten 拟合图
     * 散点：[S] vs V；拟合曲线：平滑 MM 曲线
     */
    function renderMMChart(S, V, Km, Vmax) {
        /* 数据散点 */
        var dataPoints = S.map(function (s, i) {
            return { x: s, y: V[i] };
        });

        /* 生成拟合曲线（从 0 到 S_max 的 1.2 倍） */
        var sMax = Math.max.apply(null, S);
        var curvePoints = [];
        var steps = 150;
        for (var i = 0; i <= steps; i++) {
            var s = sMax * 1.2 * i / steps;
            curvePoints.push({ x: s, y: mmPredict(s, Km, Vmax) });
        }

        var datasets = [
            {
                label: '实验数据',
                data: dataPoints,
                backgroundColor: DOT_COLOR,
                borderColor: DOT_BORDER,
                pointRadius: 5,
                showLine: false
            },
            {
                label: 'Michaelis-Menten 拟合',
                data: curvePoints,
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
                x: { type: 'linear', title: { display: true, text: '底物浓度 [S]' } },
                y: { type: 'linear', title: { display: true, text: '反应速率 V' } }
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

        BioAssay.renderChart('kineticsChart', {
            type: 'scatter',
            data: { datasets: datasets },
            options: opts
        });
    }

    /**
     * 渲染 Lineweaver-Burk 双倒数图
     * 散点：1/[S] vs 1/V；拟合直线
     */
    function renderLBChart(fit) {
        /* 数据散点 */
        var dataPoints = fit.tx.map(function (x, i) {
            return { x: x, y: fit.ty[i] };
        });

        /* 拟合直线：适当延伸至数据范围之外以显示截距 */
        var xMin = Math.min.apply(null, fit.tx);
        var xMax = Math.max.apply(null, fit.tx);
        var pad = (xMax - xMin) * 0.15;
        var linePoints = [
            { x: xMin - pad, y: fit.a * (xMin - pad) + fit.b },
            { x: xMax + pad, y: fit.a * (xMax + pad) + fit.b }
        ];

        var datasets = [
            {
                label: '实验数据 (1/[S], 1/V)',
                data: dataPoints,
                backgroundColor: DOT_COLOR,
                borderColor: DOT_BORDER,
                pointRadius: 5,
                showLine: false
            },
            {
                label: 'Lineweaver-Burk 拟合',
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
                x: { type: 'linear', title: { display: true, text: '1 / [S]' } },
                y: { type: 'linear', title: { display: true, text: '1 / V' } }
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

        BioAssay.renderChart('kineticsChart', {
            type: 'scatter',
            data: { datasets: datasets },
            options: opts
        });
    }

    /**
     * 渲染 Eadie-Hofstee 图
     * 散点：V/[S] vs V；拟合直线
     */
    function renderEHChart(fit) {
        /* 数据散点 */
        var dataPoints = fit.tx.map(function (x, i) {
            return { x: x, y: fit.ty[i] };
        });

        /* 拟合直线：适当延伸 */
        var xMin = Math.min.apply(null, fit.tx);
        var xMax = Math.max.apply(null, fit.tx);
        var pad = (xMax - xMin) * 0.15;
        var linePoints = [
            { x: xMin - pad, y: fit.a * (xMin - pad) + fit.b },
            { x: xMax + pad, y: fit.a * (xMax + pad) + fit.b }
        ];

        var datasets = [
            {
                label: '实验数据 (V/[S], V)',
                data: dataPoints,
                backgroundColor: DOT_COLOR,
                borderColor: DOT_BORDER,
                pointRadius: 5,
                showLine: false
            },
            {
                label: 'Eadie-Hofstee 拟合',
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
                x: { type: 'linear', title: { display: true, text: 'V / [S]' } },
                y: { type: 'linear', title: { display: true, text: 'V' } }
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

        BioAssay.renderChart('kineticsChart', {
            type: 'scatter',
            data: { datasets: datasets },
            options: opts
        });
    }

    /* ============================================================
     * 结果表格渲染
     * ============================================================ */

    /**
     * 渲染动力学参数结果表
     * @param {Object}  fit     拟合结果 {Km, Vmax, r2, equation}
     * @param {number}  enzConc 酶浓度 (μM)，可为 null
     * @param {string}  method  方法标识 'mm'/'lb'/'eh'
     */
    function renderResultTable(fit, enzConc, method) {
        var html = '';

        /* ---- 动力学参数表 ---- */
        var rows = [
            ['Km',       BioAssay.fmt(fit.Km, 4),   '米氏常数'],
            ['Vmax',     BioAssay.fmt(fit.Vmax, 4), '最大反应速率'],
            ['R²',       BioAssay.fmt(fit.r2, 6),   '决定系数（原始 V 数据）'],
            ['拟合方程', fit.equation,              '']
        ];

        /* 若提供了酶浓度，计算 kcat 与催化效率 */
        if (enzConc && enzConc > 0) {
            var kcat = fit.Vmax / enzConc;
            var efficiency = kcat / fit.Km;
            rows.push(['kcat',         BioAssay.fmt(kcat, 4),       '转换数 = Vmax / [E]']);
            rows.push(['kcat / Km',    BioAssay.fmt(efficiency, 4), '催化效率']);
        }

        html += '<h4>动力学参数</h4>';
        html += BioAssay.table(['参数', '值', '说明'], rows);

        /* ---- 方法说明 ---- */
        var methodDesc = {
            mm: 'Michaelis-Menten 直接非线性最小二乘拟合，梯度下降优化。',
            lb: 'Lineweaver-Burk 双倒数线性化：1/V 对 1/[S] 线性回归，' +
                'Vmax = 1/截距，Km = 斜率 × Vmax。',
            eh: 'Eadie-Hofstee 线性化：V 对 V/[S] 线性回归，' +
                'Vmax = 截距，Km = −斜率。'
        };
        html += BioAssay.infoBox(methodDesc[method]);

        els.result.innerHTML = html;
    }

    /* ============================================================
     * 主流程
     * ============================================================ */

    /** 执行酶动力学拟合分析 */
    function doFit() {
        /* 解析数据 */
        var dataText = els.data.value.trim();
        if (!dataText) {
            els.result.innerHTML = BioAssay.errorBox('请输入底物浓度与反应速率数据');
            return;
        }

        var pairs = BioAssay.parsePairs(dataText);
        if (!pairs || pairs.length < 3) {
            els.result.innerHTML = BioAssay.errorBox('至少需要 3 个数据点才能进行动力学拟合');
            return;
        }

        /* 提取 [S] 和 V 数组 */
        var S = pairs.map(function (p) { return p.x; });
        var V = pairs.map(function (p) { return p.y; });

        /* 校验数据有效性 */
        for (var i = 0; i < S.length; i++) {
            if (S[i] < 0) {
                els.result.innerHTML = BioAssay.errorBox('底物浓度 [S] 不能为负值');
                return;
            }
            if (V[i] < 0) {
                els.result.innerHTML = BioAssay.errorBox('反应速率 V 不能为负值');
                return;
            }
        }

        /* 解析酶浓度（可选） */
        var enzConc = null;
        var enzText = els.enzConc.value.trim();
        if (enzText) {
            enzConc = parseFloat(enzText);
            if (isNaN(enzConc) || enzConc <= 0) {
                els.result.innerHTML = BioAssay.errorBox('酶浓度必须为正数');
                return;
            }
        }

        /* 选择分析方法 */
        var method = els.plotType.value;
        var fit;

        if (method === 'mm') {
            fit = fitMichaelisMenten(S, V);
        } else if (method === 'lb') {
            fit = fitLineweaverBurk(S, V);
        } else {
            fit = fitEadieHofstee(S, V);
        }

        if (!fit) {
            els.result.innerHTML = BioAssay.errorBox(
                '拟合失败，请检查数据是否合理（如 [S] 和 V 均需为正）'
            );
            return;
        }

        /* 更新图表标题 */
        if (els.chartTitle) els.chartTitle.textContent = TITLES[method];

        /* 渲染图表 */
        if (method === 'mm') {
            renderMMChart(S, V, fit.Km, fit.Vmax);
        } else if (method === 'lb') {
            renderLBChart(fit);
        } else {
            renderEHChart(fit);
        }

        /* 渲染结果表格 */
        renderResultTable(fit, enzConc, method);
    }

    /** 清空所有输入与结果 */
    function doClear() {
        els.data.value = '';
        els.enzConc.value = '';
        els.result.innerHTML = '';
        BioAssay.destroyChart('kineticsChart');
        /* 恢复默认标题 */
        if (els.chartTitle) els.chartTitle.textContent = TITLES.mm;
        /* 恢复默认选项 */
        if (els.plotType) els.plotType.value = 'mm';
    }

    /** 作图方式切换时即时更新标题 */
    function onPlotTypeChange() {
        var method = els.plotType.value;
        if (els.chartTitle && TITLES[method]) {
            els.chartTitle.textContent = TITLES[method];
        }
    }

    /* ============================================================
     * 事件绑定
     * ============================================================ */
    if (els.fitBtn)     els.fitBtn.addEventListener('click', doFit);
    if (els.clearBtn)   els.clearBtn.addEventListener('click', doClear);
    if (els.plotType)   els.plotType.addEventListener('change', onPlotTypeChange);

})();
