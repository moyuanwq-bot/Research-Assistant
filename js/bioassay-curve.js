/**
 * bioassay-curve.js — 标准曲线拟合模块
 *
 * 依赖（全局）：
 *   Chart    — Chart.js 图表库
 *   BioAssay — 辅助对象，提供以下方法：
 *     parsePairs(text)        解析"浓度,OD"文本对，返回 [[x,y], ...]
 *     parseNumbers(text)      解析纯数字文本，返回 [n, ...]
 *     mean(arr) / sd(arr) / sem(arr) / cv(arr)
 *     rSquared(actual, predicted)   计算 R²
 *     table(headers, rows)          生成 HTML 表格字符串
 *     fmt(v, decimals)              数字格式化
 *     chartDefaults                 图表默认配置
 *     destroyChart(id) / renderChart(id, config)
 *     errorBox(msg) / infoBox(msg)
 *
 * 拟合模型：
 *   linear — 线性回归 y = ax + b
 *   pl4    — 四参数 Logistic  y = (A−D)/(1+(x/C)^B) + D
 *   poly2  — 二次多项式       y = ax² + bx + c
 */
(function () {
    'use strict';

    /* ============================================================
     * DOM 元素引用
     * ============================================================ */
    var els = {
        model:       document.getElementById('curveModel'),
        stdData:     document.getElementById('curveStdData'),
        unknownData: document.getElementById('curveUnknownData'),
        fitBtn:      document.getElementById('curveFitBtn'),
        clearBtn:    document.getElementById('curveClearBtn'),
        chart:       document.getElementById('curveChart'),
        result:      document.getElementById('curveResult')
    };

    /* ============================================================
     * 通用辅助函数
     * ============================================================ */

    /** 计算数组中位数 */
    function median(arr) {
        var s = arr.slice().sort(function (a, b) { return a - b; });
        var m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }

    /** 求解 3×3 线性方程组 M·x = v（Cramer 法则），返回 [x0,x1,x2] 或 null */
    function solve3x3(M, v) {
        function det(m) {
            return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
                 - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
                 + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
        }
        var D = det(M);
        if (Math.abs(D) < 1e-15) return null;
        var M0 = [[v[0], M[0][1], M[0][2]], [v[1], M[1][1], M[1][2]], [v[2], M[2][1], M[2][2]]];
        var M1 = [[M[0][0], v[0], M[0][2]], [M[1][0], v[1], M[1][2]], [M[2][0], v[2], M[2][2]]];
        var M2 = [[M[0][0], M[0][1], v[0]], [M[1][0], M[1][1], v[1]], [M[2][0], M[2][1], v[2]]];
        return [det(M0) / D, det(M1) / D, det(M2) / D];
    }

    /**
     * Nelder-Mead 单纯形优化
     * @param {Function} cost  目标函数，入参为参数数组，返回标量
     * @param {Array}    init  初始参数估计
     * @param {Object}   opts  {maxIter, tol}
     * @returns {{params:Array, cost:number}}
     */
    function nelderMead(cost, init, opts) {
        opts = opts || {};
        var maxIter = opts.maxIter || 5000;
        var tol     = opts.tol     || 1e-12;
        var n       = init.length;

        /* 构建初始单纯形（n+1 个顶点） */
        var simplex = [], fvals = [];
        for (var i = 0; i <= n; i++) {
            var v = init.slice();
            if (i > 0) {
                var step = Math.abs(v[i - 1]) * 0.05;
                if (step < 1e-6) step = 0.00125;
                v[i - 1] += step;
            }
            simplex.push(v);
            fvals.push(cost(v));
        }

        var alpha = 1, gamma = 2, rho = 0.5, sigma = 0.5;

        for (var iter = 0; iter < maxIter; iter++) {
            /* 按目标值升序排序 */
            var order = [];
            for (var i = 0; i <= n; i++) order.push(i);
            order.sort(function (a, b) { return fvals[a] - fvals[b]; });

            /* 收敛判断 */
            if (Math.abs(fvals[order[n]] - fvals[order[0]]) < tol) break;

            /* 计算重心（排除最差点） */
            var centroid = new Array(n).fill(0);
            for (var i = 0; i < n; i++)
                for (var j = 0; j < n; j++)
                    centroid[j] += simplex[order[i]][j];
            for (var j = 0; j < n; j++) centroid[j] /= n;

            var worstIdx = order[n];

            /* 反射 */
            var reflected = new Array(n);
            for (var j = 0; j < n; j++)
                reflected[j] = centroid[j] + alpha * (centroid[j] - simplex[worstIdx][j]);
            var fr = cost(reflected);

            if (fr >= fvals[order[0]] && fr < fvals[order[n - 1]]) {
                simplex[worstIdx] = reflected;
                fvals[worstIdx] = fr;
            } else if (fr < fvals[order[0]]) {
                /* 扩展 */
                var expanded = new Array(n);
                for (var j = 0; j < n; j++)
                    expanded[j] = centroid[j] + gamma * (reflected[j] - centroid[j]);
                var fe = cost(expanded);
                if (fe < fr) { simplex[worstIdx] = expanded; fvals[worstIdx] = fe; }
                else         { simplex[worstIdx] = reflected; fvals[worstIdx] = fr; }
            } else {
                /* 收缩 */
                var contracted = new Array(n);
                for (var j = 0; j < n; j++)
                    contracted[j] = centroid[j] + rho * (simplex[worstIdx][j] - centroid[j]);
                var fc = cost(contracted);
                if (fc < fvals[worstIdx]) {
                    simplex[worstIdx] = contracted;
                    fvals[worstIdx] = fc;
                } else {
                    /* 压缩整个单纯形 */
                    var bestIdx = order[0];
                    for (var i = 0; i <= n; i++) {
                        if (i === bestIdx) continue;
                        for (var j = 0; j < n; j++)
                            simplex[i][j] = simplex[bestIdx][j] + sigma * (simplex[i][j] - simplex[bestIdx][j]);
                        fvals[i] = cost(simplex[i]);
                    }
                }
            }
        }

        /* 返回最优顶点 */
        var bestIdx = 0;
        for (var i = 1; i <= n; i++)
            if (fvals[i] < fvals[bestIdx]) bestIdx = i;
        return { params: simplex[bestIdx], cost: fvals[bestIdx] };
    }

    /* ============================================================
     * 拟合算法
     * ============================================================ */

    /**
     * 1. 线性回归 y = ax + b
     * 最小二乘法：a = Σ((x-x̄)(y-ȳ)) / Σ((x-x̄)²)，b = ȳ − a·x̄
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

    /**
     * 2. 四参数 Logistic 拟合
     *    y = (A − D) / (1 + (x/C)^B) + D
     *    A = 最小渐近线，D = 最大渐近线，C = EC50，B = Hill 斜率
     *    使用 Nelder-Mead 迭代优化
     *    反函数：x = C · ((A−D)/(y−D) − 1)^(1/B)
     */
    function fit4PL(xs, ys) {
        /* 初始参数估计 */
        var A0 = Math.min.apply(null, ys);
        var D0 = Math.max.apply(null, ys);
        var C0 = median(xs);
        var B0 = 1;

        /* 残差平方和目标函数 */
        function sse(p) {
            var A = p[0], B = p[1], C = p[2], D = p[3];
            if (C <= 0) return 1e30;          /* EC50 必须为正 */
            var sum = 0;
            for (var i = 0; i < xs.length; i++) {
                var pred = (A - D) / (1 + Math.pow(xs[i] / C, B)) + D;
                sum += (ys[i] - pred) * (ys[i] - pred);
            }
            return sum;
        }

        var result = nelderMead(sse, [A0, B0, C0, D0], { maxIter: 8000, tol: 1e-14 });
        var A = result.params[0], B = result.params[1], C = result.params[2], D = result.params[3];
        if (C < 0) C = Math.abs(C);            /* 确保 EC50 为正 */

        var predicted = xs.map(function (x) {
            return (A - D) / (1 + Math.pow(x / C, B)) + D;
        });
        var r2 = BioAssay.rSquared(ys, predicted);

        return {
            A: A, B: B, C: C, D: D, r2: r2,
            predict: function (x) {
                return (A - D) / (1 + Math.pow(x / C, B)) + D;
            },
            inverse: function (y) {
                /* x = C · ((A−D)/(y−D) − 1)^(1/B) */
                var denom = y - D;
                if (Math.abs(denom) < 1e-15) return NaN;
                var val = (A - D) / denom - 1;
                if (val <= 0) return NaN;
                return C * Math.pow(val, 1 / B);
            },
            equation: '4PL: A=' + BioAssay.fmt(A, 4) +
                      ', B=' + BioAssay.fmt(B, 4) +
                      ', C=' + BioAssay.fmt(C, 4) +
                      ', D=' + BioAssay.fmt(D, 4)
        };
    }

    /**
     * 3. 二次多项式拟合 y = ax² + bx + c
     *    最小二乘正规方程 3×3，Cramer 法则求解
     *    反函数：x = (−b + √(b²−4a(c−y))) / (2a)（取正根）
     */
    function fitPoly2(xs, ys) {
        var n = xs.length;
        var Sx = 0, Sx2 = 0, Sx3 = 0, Sx4 = 0;
        var Sy = 0, Sxy = 0, Sx2y = 0;

        for (var i = 0; i < n; i++) {
            var x = xs[i], y = ys[i], x2 = x * x;
            Sx   += x;
            Sx2  += x2;
            Sx3  += x2 * x;
            Sx4  += x2 * x2;
            Sy   += y;
            Sxy  += x * y;
            Sx2y += x2 * y;
        }

        /* 正规方程组矩阵 */
        var M = [[Sx4, Sx3, Sx2], [Sx3, Sx2, Sx], [Sx2, Sx, n]];
        var v = [Sx2y, Sxy, Sy];
        var sol = solve3x3(M, v);
        if (!sol) return null;

        var a = sol[0], b = sol[1], c = sol[2];
        var predicted = xs.map(function (x) { return a * x * x + b * x + c; });
        var r2 = BioAssay.rSquared(ys, predicted);

        return {
            a: a, b: b, c: c, r2: r2,
            predict: function (x) { return a * x * x + b * x + c; },
            inverse: function (y) {
                var disc = b * b - 4 * a * (c - y);
                if (disc < 0) return NaN;
                return (-b + Math.sqrt(disc)) / (2 * a);
            },
            equation: 'y = ' + BioAssay.fmt(a, 6) + 'x² + ' +
                      BioAssay.fmt(b, 6) + 'x + ' + BioAssay.fmt(c, 6)
        };
    }

    /* ============================================================
     * 图表渲染
     * ============================================================ */

    /**
     * 渲染拟合图表
     * @param {Array}  stdPoints     标准品散点 [{x,y}, ...]
     * @param {Function} fitFn       拟合预测函数
     * @param {Array}  unknownPoints 未知样品点 [{x,y}, ...]
     */
    function renderFitChart(stdPoints, fitFn, unknownPoints) {
        /* 生成拟合曲线平滑数据点 */
        var xMin = Math.min.apply(null, stdPoints.map(function (p) { return p.x; }));
        var xMax = Math.max.apply(null, stdPoints.map(function (p) { return p.x; }));
        var range = xMax - xMin;
        var pad = range * 0.05;
        var curvePoints = [];
        var steps = 120;
        for (var i = 0; i <= steps; i++) {
            var x = (xMin - pad) + (range + 2 * pad) * i / steps;
            var y = fitFn(x);
            if (isFinite(y)) curvePoints.push({ x: x, y: y });
        }

        var datasets = [
            {
                label: '标准品',
                data: stdPoints,
                backgroundColor: 'rgba(54, 108, 235, 0.7)',
                borderColor: 'rgba(54, 108, 235, 1)',
                pointRadius: 5,
                pointStyle: 'circle',
                showLine: false
            },
            {
                label: '拟合曲线',
                data: curvePoints,
                borderColor: '#087f89',
                backgroundColor: '#087f89',
                borderWidth: 2,
                pointRadius: 0,
                showLine: true,
                tension: 0
            }
        ];

        /* 未知样品：红色三角形 */
        if (unknownPoints && unknownPoints.length > 0) {
            datasets.push({
                label: '未知样品',
                data: unknownPoints,
                backgroundColor: 'rgba(220, 53, 69, 0.85)',
                borderColor: 'rgba(220, 53, 69, 1)',
                pointRadius: 6,
                pointStyle: 'triangle',
                showLine: false
            });
        }

        /* 合并默认配置 */
        var opts = Object.assign({}, BioAssay.chartDefaults, {
            scales: {
                x: { type: 'linear', title: { display: true, text: '浓度' } },
                y: { type: 'linear', title: { display: true, text: 'OD 值' } }
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

        BioAssay.renderChart('curveChart', {
            type: 'scatter',
            data: { datasets: datasets },
            options: opts
        });
    }

    /* ============================================================
     * 结果表格渲染
     * ============================================================ */

    /**
     * 渲染拟合参数与未知样品结果表格
     * @param {Object} fit      拟合结果对象
     * @param {Array}  unknowns 未知样品 [{od, conc}, ...]
     * @param {string} model    模型名称
     */
    function renderResultTable(fit, unknowns, model) {
        var html = '';

        /* ---- 拟合参数表 ---- */
        var headers, rows;
        if (model === 'linear') {
            headers = ['参数', '值'];
            rows = [
                ['斜率 (a)', BioAssay.fmt(fit.a, 6)],
                ['截距 (b)', BioAssay.fmt(fit.b, 6)],
                ['R²',       BioAssay.fmt(fit.r2, 6)],
                ['方程',     fit.equation]
            ];
        } else if (model === 'pl4') {
            headers = ['参数', '值', '说明'];
            rows = [
                ['A',  BioAssay.fmt(fit.A, 6),  '最小渐近线（零剂量响应）'],
                ['B',  BioAssay.fmt(fit.B, 6),  'Hill 斜率'],
                ['C',  BioAssay.fmt(fit.C, 6),  'EC50（拐点浓度）'],
                ['D',  BioAssay.fmt(fit.D, 6),  '最大渐近线（无穷剂量响应）'],
                ['R²', BioAssay.fmt(fit.r2, 6), '决定系数']
            ];
        } else {
            headers = ['参数', '值'];
            rows = [
                ['a',  BioAssay.fmt(fit.a, 6)],
                ['b',  BioAssay.fmt(fit.b, 6)],
                ['c',  BioAssay.fmt(fit.c, 6)],
                ['R²', BioAssay.fmt(fit.r2, 6)],
                ['方程', fit.equation]
            ];
        }

        html += '<h4>拟合参数</h4>';
        html += BioAssay.table(headers, rows);

        /* ---- 未知样品结果表 ---- */
        if (unknowns && unknowns.length > 0) {
            html += '<h4>未知样品计算结果</h4>';
            var uHeaders = ['序号', 'OD 值', '计算浓度'];
            var uRows = unknowns.map(function (u, i) {
                return [
                    String(i + 1),
                    BioAssay.fmt(u.od, 4),
                    isFinite(u.conc) ? BioAssay.fmt(u.conc, 4) : 'N/A'
                ];
            });
            html += BioAssay.table(uHeaders, uRows);
        }

        els.result.innerHTML = html;
    }

    /* ============================================================
     * 主流程
     * ============================================================ */

    /** 执行曲线拟合 */
    function doFit() {
        /* 解析标准品数据 */
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

        /* 检查数据点数量是否满足模型要求 */
        var model = els.model.value;
        var minPts = model === 'pl4' ? 4 : (model === 'poly2' ? 3 : 2);
        if (stdPairs.length < minPts) {
            els.result.innerHTML = BioAssay.errorBox(
                model === 'pl4' ? '4PL 拟合至少需要 4 个数据点'
                                : '二次多项式拟合至少需要 3 个数据点'
            );
            return;
        }

        var xs = stdPairs.map(function (p) { return p[0]; });
        var ys = stdPairs.map(function (p) { return p[1]; });

        /* 选择拟合算法 */
        var fit;
        if (model === 'linear')      fit = fitLinear(xs, ys);
        else if (model === 'pl4')    fit = fit4PL(xs, ys);
        else                         fit = fitPoly2(xs, ys);

        if (!fit) {
            els.result.innerHTML = BioAssay.errorBox('拟合失败，请检查数据是否合理');
            return;
        }

        /* 解析未知样品 OD 值并反算浓度 */
        var unknowns = [];
        var unkText = els.unknownData.value.trim();
        if (unkText) {
            var unkODs = BioAssay.parseNumbers(unkText);
            unknowns = unkODs.map(function (od) {
                return { od: od, conc: fit.inverse(od) };
            });
        }

        /* 渲染图表 */
        var stdPoints = stdPairs.map(function (p) { return { x: p[0], y: p[1] }; });
        var unkPoints = unknowns.filter(function (u) { return isFinite(u.conc); })
                                .map(function (u) { return { x: u.conc, y: u.od }; });
        renderFitChart(stdPoints, fit.predict, unkPoints);

        /* 渲染结果表格 */
        renderResultTable(fit, unknowns, model);
    }

    /** 清空所有输入与结果 */
    function doClear() {
        els.stdData.value = '';
        els.unknownData.value = '';
        els.result.innerHTML = '';
        BioAssay.destroyChart('curveChart');
    }

    /* ============================================================
     * 事件绑定
     * ============================================================ */
    if (els.fitBtn)   els.fitBtn.addEventListener('click', doFit);
    if (els.clearBtn) els.clearBtn.addEventListener('click', doClear);

})();
