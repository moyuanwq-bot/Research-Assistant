// AI生成
/**
 * bioassay-stats.js — 统计分析与作图模块
 *
 * 依赖（全局）：
 *   Chart    — Chart.js 图表库
 *   BioAssay — 辅助对象，提供以下方法：
 *     mean(arr) / sd(arr) / sem(arr) / cv(arr)
 *     median(arr) / quantile(arr, q)
 *     rSquared(actual, predicted)
 *     table(headers, rows)          生成 HTML 表格字符串
 *     fmt(v, decimals)              数字格式化
 *     chartDefaults                 图表默认配置
 *     destroyChart(id) / renderChart(id, config)
 *     errorBox(msg) / infoBox(msg)
 *
 * 功能：
 *   - 描述性统计（N、均值、SD、SEM、CV%、中位数、最小值、最大值、Q1、Q3）
 *   - 配对 t 检验
 *   - 非配对 t 检验（Welch 校正）
 *   - 单因素方差分析（ANOVA）
 *   - 四种图表：柱状图+误差棒、散点图+回归线、箱线图、折线图
 */
(function () {
    'use strict';

    /* ============================================================
     * DOM 元素引用
     * ============================================================ */
    var els = {
        chartType:   document.getElementById('statsChartType'),
        errorType:   document.getElementById('statsErrorType'),
        data:        document.getElementById('statsData'),
        testType:    document.getElementById('statsTestType'),
        analyzeBtn:  document.getElementById('statsAnalyzeBtn'),
        clearBtn:    document.getElementById('statsClearBtn'),
        exportBtn:   document.getElementById('statsExportBtn'),
        chart:       document.getElementById('statsChart'),
        chartTitle:  document.getElementById('statsChartTitle'),
        result:      document.getElementById('statsResult')
    };

    /* ============================================================
     * 常量定义
     * ============================================================ */

    /* 分组配色方案（填充色） */
    var FILL_COLORS = [
        'rgba(54, 108, 235, 0.7)',
        'rgba(255, 99, 132, 0.7)',
        'rgba(75, 192, 192, 0.7)',
        'rgba(255, 159, 64, 0.7)',
        'rgba(153, 102, 255, 0.7)',
        'rgba(255, 205, 86, 0.7)',
        'rgba(54, 162, 235, 0.7)',
        'rgba(201, 203, 207, 0.7)'
    ];

    /* 分组配色方案（边框色） */
    var BORDER_COLORS = [
        'rgba(54, 108, 235, 1)',
        'rgba(255, 99, 132, 1)',
        'rgba(75, 192, 192, 1)',
        'rgba(255, 159, 64, 1)',
        'rgba(153, 102, 255, 1)',
        'rgba(255, 205, 86, 1)',
        'rgba(54, 162, 235, 1)',
        'rgba(201, 203, 207, 1)'
    ];

    /* 回归线 / 拟合线品牌色 */
    var BRAND = '#087f89';

    /* 图表标题映射 */
    var TITLES = {
        bar:     '柱状图（均值 ± 误差棒）',
        scatter: '散点图与线性回归',
        box:     '箱线图',
        line:    '折线图（时间序列）'
    };

    /* 误差棒数据（供自定义插件读取） */
    var errorBarData = [];
    /* 箱线图数据（供自定义插件读取） */
    var boxPlotData = [];

    /* ============================================================
     * 数据解析
     * ============================================================ */

    /**
     * 解析 "组名: val1, val2, ..." 格式的文本
     * 每行一个分组，返回 [{name, values}, ...]
     * @param {string} text 原始输入文本
     * @returns {Array<{name:string, values:number[]}>}
     */
    function parseGroups(text) {
        var lines = text.trim().split('\n');
        var groups = [];
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;

            /* 分割组名与数值列表（兼容中英文冒号） */
            var ci = line.indexOf(':');
            if (ci === -1) ci = line.indexOf('：');
            if (ci === -1) continue;

            var name = line.substring(0, ci).trim();
            var valuesText = line.substring(ci + 1).trim();
            var parts = valuesText.split(/[,;\t\s]+/).filter(function (p) {
                return p !== '';
            });

            var values = [];
            for (var j = 0; j < parts.length; j++) {
                var v = parseFloat(parts[j]);
                if (!isNaN(v)) values.push(v);
            }

            if (values.length > 0) {
                groups.push({
                    name:   name || ('组' + (groups.length + 1)),
                    values: values
                });
            }
        }
        return groups;
    }

    /* ============================================================
     * 统计分布函数（p 值计算）
     * ============================================================ */

    /**
     * Lanczos 近似计算 ln(Γ(x))
     * @param {number} x
     * @returns {number}
     */
    function logGamma(x) {
        var g = 7;
        var c = [
            0.99999999999980993,
            676.5203681218851,
            -1259.1392167224028,
            771.32342877765313,
            -176.6150251620962,
            12.50734327852827,
            -0.13857109526572012,
            9.984059437671335e-6,
            1.5056327351493116e-7
        ];

        /* x < 0.5 时使用反射公式 */
        if (x < 0.5) {
            return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
        }

        x -= 1;
        var a = c[0];
        var t = x + g + 0.5;
        for (var i = 1; i < g + 2; i++) {
            a += c[i] / (x + i);
        }
        return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
    }

    /**
     * 正则化不完全 Beta 函数的连分式展开（Lentz 算法）
     * @param {number} x  自变量 (0 < x < 1)
     * @param {number} a  参数 a
     * @param {number} b  参数 b
     * @returns {number}
     */
    function betaCF(x, a, b) {
        var MAXIT = 300;
        var EPS   = 3e-10;
        var FPMIN = 1e-30;

        var qab = a + b;
        var qap = a + 1;
        var qam = a - 1;

        var c = 1;
        var d = 1 - qab * x / qap;
        if (Math.abs(d) < FPMIN) d = FPMIN;
        d = 1 / d;
        var h = d;

        for (var m = 1; m <= MAXIT; m++) {
            var m2 = 2 * m;

            /* 偶数步连分式项 */
            var aa = m * (b - m) * x / ((qam + m2) * (a + m2));
            d = 1 + aa * d;
            if (Math.abs(d) < FPMIN) d = FPMIN;
            c = 1 + aa / c;
            if (Math.abs(c) < FPMIN) c = FPMIN;
            d = 1 / d;
            h *= d * c;

            /* 奇数步连分式项 */
            aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
            d = 1 + aa * d;
            if (Math.abs(d) < FPMIN) d = FPMIN;
            c = 1 + aa / c;
            if (Math.abs(c) < FPMIN) c = FPMIN;
            d = 1 / d;
            var del = d * c;
            h *= del;
            if (Math.abs(del - 1) < EPS) break;
        }

        return h;
    }

    /**
     * 正则化不完全 Beta 函数 I_x(a, b)
     * 利用对称关系选择收敛更快的路径
     * @param {number} x  自变量 (0 ≤ x ≤ 1)
     * @param {number} a  参数 a > 0
     * @param {number} b  参数 b > 0
     * @returns {number}
     */
    function betaInc(x, a, b) {
        if (x <= 0) return 0;
        if (x >= 1) return 1;

        var lbeta = logGamma(a + b) - logGamma(a) - logGamma(b)
                  + a * Math.log(x) + b * Math.log(1 - x);

        if (x < (a + 1) / (a + b + 2)) {
            return Math.exp(lbeta) * betaCF(x, a, b) / a;
        } else {
            return 1 - Math.exp(lbeta) * betaCF(1 - x, b, a) / b;
        }
    }

    /**
     * t 分布双侧 p 值
     * p = I_{df/(df+t²)}(df/2, 1/2)
     * @param {number} t   t 统计量
     * @param {number} df  自由度
     * @returns {number}   双侧 p 值
     */
    function tDistPValue(t, df) {
        if (df <= 0) return NaN;
        var x = df / (df + t * t);
        return betaInc(x, df / 2, 0.5);
    }

    /**
     * F 分布上尾 p 值
     * p = I_{df2/(df2+df1·F)}(df2/2, df1/2)
     * @param {number} f    F 统计量
     * @param {number} df1  分子自由度
     * @param {number} df2  分母自由度
     * @returns {number}    上尾 p 值
     */
    function fDistPValue(f, df1, df2) {
        if (df1 <= 0 || df2 <= 0) return NaN;
        if (f <= 0) return 1;
        var x = df2 / (df2 + df1 * f);
        return betaInc(x, df2 / 2, df1 / 2);
    }

    /* ============================================================
     * 显著性标记与 p 值格式化
     * ============================================================ */

    /** 根据 p 值返回显著性星号 */
    function sigStars(p) {
        if (p < 0.001) return '***';
        if (p < 0.01)  return '**';
        if (p < 0.05)  return '*';
        return 'ns';
    }

    /** 格式化 p 值显示文本 */
    function fmtP(p) {
        if (isNaN(p)) return '—';
        if (p < 0.001) return 'p < 0.001';
        return 'p = ' + BioAssay.fmt(p, 3);
    }

    /* ============================================================
     * 描述性统计
     * ============================================================ */

    /**
     * 计算一组数据的描述性统计量
     * @param {number[]} values 数值数组
     * @returns {{n, mean, sd, sem, cv, median, min, max, q1, q3}}
     */
    function descriptive(values) {
        return {
            n:      values.length,
            mean:   BioAssay.mean(values),
            sd:     BioAssay.sd(values),
            sem:    BioAssay.sem(values),
            cv:     BioAssay.cv(values),
            median: BioAssay.median(values),
            min:    Math.min.apply(null, values),
            max:    Math.max.apply(null, values),
            q1:     BioAssay.quantile(values, 0.25),
            q3:     BioAssay.quantile(values, 0.75)
        };
    }

    /* ============================================================
     * 统计检验
     * ============================================================ */

    /**
     * 配对 t 检验
     * d_i = x_i − y_i，t = mean(d) / (sd(d) / √n)，df = n − 1
     * @param {number[]} g1 第一组数据
     * @param {number[]} g2 第二组数据
     * @returns {Object|null}
     */
    function pairedTTest(g1, g2) {
        var n = Math.min(g1.length, g2.length);
        if (n < 2) return null;

        /* 逐元素求差 */
        var diffs = [];
        for (var i = 0; i < n; i++) {
            diffs.push(g1[i] - g2[i]);
        }

        var meanD = BioAssay.mean(diffs);
        var sdD   = BioAssay.sd(diffs);
        var seD   = sdD / Math.sqrt(n);
        if (seD === 0) return null;

        var t  = meanD / seD;
        var df = n - 1;
        var p  = tDistPValue(t, df);

        return {
            test:      '配对 t 检验',
            statistic: t,
            df:        df,
            pValue:    p,
            meanDiff:  meanD,
            sdDiff:    sdD,
            n:         n
        };
    }

    /**
     * 非配对 t 检验（Welch 校正）
     * t = (mean1 − mean2) / √(se1² + se2²)
     * df = (se1² + se2²)² / (se1⁴/(n1−1) + se2⁴/(n2−1))
     * @param {number[]} g1 第一组数据
     * @param {number[]} g2 第二组数据
     * @returns {Object|null}
     */
    function unpairedTTest(g1, g2) {
        var n1 = g1.length, n2 = g2.length;
        if (n1 < 2 || n2 < 2) return null;

        var mean1 = BioAssay.mean(g1);
        var mean2 = BioAssay.mean(g2);
        var sd1   = BioAssay.sd(g1);
        var sd2   = BioAssay.sd(g2);
        var se1   = sd1 / Math.sqrt(n1);
        var se2   = sd2 / Math.sqrt(n2);

        var v1 = se1 * se1, v2 = se2 * se2;
        var seDiff = Math.sqrt(v1 + v2);
        if (seDiff === 0) return null;

        var t  = (mean1 - mean2) / seDiff;
        /* Welch-Satterthwaite 自由度 */
        var df = (v1 + v2) * (v1 + v2) / (v1 * v1 / (n1 - 1) + v2 * v2 / (n2 - 1));
        var p  = tDistPValue(t, df);

        return {
            test:      '非配对 t 检验 (Welch)',
            statistic: t,
            df:        df,
            pValue:    p,
            mean1:     mean1,
            mean2:     mean2,
            meanDiff:  mean1 - mean2,
            n1:        n1,
            n2:        n2
        };
    }

    /**
     * 单因素方差分析 (One-way ANOVA)
     * SSB = Σ n_i·(mean_i − grandMean)²
     * SSW = Σ Σ (x_ij − mean_i)²
     * F = MSB / MSW = (SSB/(k−1)) / (SSW/(N−k))
     * @param {Array<{values:number[]}>} groups 分组数组
     * @returns {Object|null}
     */
    function anovaTest(groups) {
        var k = groups.length;
        if (k < 2) return null;

        var allValues  = [];
        var groupMeans = [];
        var groupNs    = [];

        for (var i = 0; i < k; i++) {
            allValues  = allValues.concat(groups[i].values);
            groupMeans.push(BioAssay.mean(groups[i].values));
            groupNs.push(groups[i].values.length);
        }

        var N         = allValues.length;
        var grandMean = BioAssay.mean(allValues);

        /* 组间平方和 SSB */
        var ssb = 0;
        for (var i = 0; i < k; i++) {
            var d = groupMeans[i] - grandMean;
            ssb += groupNs[i] * d * d;
        }

        /* 组内平方和 SSW */
        var ssw = 0;
        for (var i = 0; i < k; i++) {
            var m = groupMeans[i];
            for (var j = 0; j < groups[i].values.length; j++) {
                var r = groups[i].values[j] - m;
                ssw += r * r;
            }
        }

        var dfB = k - 1;
        var dfW = N - k;
        if (dfW <= 0) return null;

        var msb = ssb / dfB;
        var msw = ssw / dfW;
        if (msw === 0) return null;

        var F = msb / msw;
        var p = fDistPValue(F, dfB, dfW);

        return {
            test:      '单因素方差分析 (ANOVA)',
            statistic: F,
            df1:       dfB,
            df2:       dfW,
            ssb:       ssb,
            ssw:       ssw,
            msb:       msb,
            msw:       msw,
            pValue:    p,
            k:         k,
            N:         N
        };
    }

    /* ============================================================
     * 自定义图表插件
     * ============================================================ */

    /**
     * 误差棒插件 —— 在柱状图上绘制均值 ± SD/SEM 的误差棒
     * 读取模块级 errorBarData 数组：[{mean, error}, ...]
     */
    var errorBarPlugin = {
        id: 'errorBars',
        afterDatasetsDraw: function (chart) {
            var ctx = chart.ctx;
            var yScale = chart.scales.y;
            if (!yScale || errorBarData.length === 0) return;

            chart.data.datasets.forEach(function (dataset, dsi) {
                var meta = chart.getDatasetMeta(dsi);
                if (!meta.data) return;

                meta.data.forEach(function (bar, index) {
                    var eb = errorBarData[index];
                    if (!eb || eb.error <= 0) return;

                    var x       = bar.x;
                    var yTop    = yScale.getPixelForValue(eb.mean + eb.error);
                    var yBottom = yScale.getPixelForValue(eb.mean - eb.error);

                    ctx.save();
                    ctx.strokeStyle = '#333333';
                    ctx.lineWidth   = 1.5;
                    ctx.lineCap     = 'round';

                    /* 竖线 */
                    ctx.beginPath();
                    ctx.moveTo(x, yTop);
                    ctx.lineTo(x, yBottom);
                    ctx.stroke();

                    /* 上限帽 */
                    ctx.beginPath();
                    ctx.moveTo(x - 6, yTop);
                    ctx.lineTo(x + 6, yTop);
                    ctx.stroke();

                    /* 下限帽 */
                    ctx.beginPath();
                    ctx.moveTo(x - 6, yBottom);
                    ctx.lineTo(x + 6, yBottom);
                    ctx.stroke();

                    ctx.restore();
                });
            });
        }
    };

    /**
     * 箱线图插件 —— 绘制中位线、须线及须帽
     * 箱体 (Q1~Q3) 由 Chart.js 浮动柱状图绘制，本插件补充其余元素
     * 读取模块级 boxPlotData 数组：[{min, q1, median, q3, max}, ...]
     */
    var boxPlotPlugin = {
        id: 'boxPlot',
        afterDatasetsDraw: function (chart) {
            var ctx    = chart.ctx;
            var yScale = chart.scales.y;
            var xScale = chart.scales.x;
            if (!yScale || !xScale || boxPlotData.length === 0) return;

            /* 从第一个柱元素读取柱宽 */
            var barWidth = 20;
            var meta0 = chart.getDatasetMeta(0);
            if (meta0 && meta0.data && meta0.data[0] && meta0.data[0].width) {
                barWidth = meta0.data[0].width;
            }

            boxPlotData.forEach(function (box, index) {
                var x     = xScale.getPixelForValue(index);
                var yMin  = yScale.getPixelForValue(box.min);
                var yQ1   = yScale.getPixelForValue(box.q1);
                var yMed  = yScale.getPixelForValue(box.median);
                var yQ3   = yScale.getPixelForValue(box.q3);
                var yMax  = yScale.getPixelForValue(box.max);
                var halfW = barWidth / 2;

                ctx.save();
                ctx.strokeStyle = '#333333';
                ctx.lineWidth   = 1.5;
                ctx.lineCap     = 'round';

                /* 中位线 */
                ctx.beginPath();
                ctx.moveTo(x - halfW, yMed);
                ctx.lineTo(x + halfW, yMed);
                ctx.stroke();

                /* 下须（Q1 → min） */
                ctx.beginPath();
                ctx.moveTo(x, yQ1);
                ctx.lineTo(x, yMin);
                ctx.stroke();

                /* 上须（Q3 → max） */
                ctx.beginPath();
                ctx.moveTo(x, yQ3);
                ctx.lineTo(x, yMax);
                ctx.stroke();

                /* 下须帽 */
                ctx.beginPath();
                ctx.moveTo(x - halfW * 0.6, yMin);
                ctx.lineTo(x + halfW * 0.6, yMin);
                ctx.stroke();

                /* 上须帽 */
                ctx.beginPath();
                ctx.moveTo(x - halfW * 0.6, yMax);
                ctx.lineTo(x + halfW * 0.6, yMax);
                ctx.stroke();

                ctx.restore();
            });
        }
    };

    /* ============================================================
     * 图表渲染
     * ============================================================ */

    /**
     * 渲染柱状图 + 误差棒
     * 每组一个柱子，高度为均值，误差棒为 SD 或 SEM
     * @param {Array<{name,values}>} groups    分组数据
     * @param {string} errorType               'sd' 或 'sem'
     */
    function renderBarChart(groups, errorType) {
        var labels = groups.map(function (g) { return g.name; });
        var means  = groups.map(function (g) { return BioAssay.mean(g.values); });

        /* 构造误差棒数据 */
        errorBarData = groups.map(function (g) {
            var err = errorType === 'sem' ? BioAssay.sem(g.values) : BioAssay.sd(g.values);
            return { mean: BioAssay.mean(g.values), error: err };
        });

        var errLabel = errorType === 'sem' ? 'SEM' : 'SD';

        var opts = Object.assign({}, BioAssay.chartDefaults, {
            scales: {
                x: { grid: { color: 'rgba(0,0,0,0.06)' }, title: { display: true, text: '分组' } },
                y: { grid: { color: 'rgba(0,0,0,0.06)' }, title: { display: true, text: '均值 ± ' + errLabel } }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (ctx) {
                            var eb = errorBarData[ctx.dataIndex];
                            return '均值 = ' + BioAssay.fmt(eb.mean, 4) +
                                   '，' + errLabel + ' = ' + BioAssay.fmt(eb.error, 4);
                        }
                    }
                }
            }
        });

        BioAssay.renderChart('statsChart', {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label:           '均值 ± ' + errLabel,
                    data:            means,
                    backgroundColor: groups.map(function (_, i) {
                        return FILL_COLORS[i % FILL_COLORS.length];
                    }),
                    borderColor: groups.map(function (_, i) {
                        return BORDER_COLORS[i % BORDER_COLORS.length];
                    }),
                    borderWidth: 1
                }]
            },
            options: opts,
            plugins: [errorBarPlugin]
        });
    }

    /**
     * 渲染散点图 + 线性回归线
     * X 轴 = 分组序号 (0, 1, 2, ...)，Y 轴 = 数值
     * 所有数据点按分组着色，拟合全局线性回归并显示 R²
     * @param {Array<{name,values}>} groups 分组数据
     */
    function renderScatterChart(groups) {
        /* 收集所有散点（x = 分组序号, y = 数值） */
        var allX = [], allY = [];
        var datasets = [];

        groups.forEach(function (g, gi) {
            var pts = g.values.map(function (v) {
                return { x: gi, y: v };
            });
            allX = allX.concat(g.values.map(function () { return gi; }));
            allY = allY.concat(g.values);

            datasets.push({
                label:           g.name,
                data:            pts,
                backgroundColor: FILL_COLORS[gi % FILL_COLORS.length],
                borderColor:     BORDER_COLORS[gi % BORDER_COLORS.length],
                pointRadius:     5,
                showLine:        false
            });
        });

        /* 线性回归 y = ax + b */
        var n  = allX.length;
        var mx = BioAssay.mean(allX);
        var my = BioAssay.mean(allY);
        var num = 0, den = 0;
        for (var i = 0; i < n; i++) {
            num += (allX[i] - mx) * (allY[i] - my);
            den += (allX[i] - mx) * (allX[i] - mx);
        }

        var a, b, r2, regLabel;
        if (Math.abs(den) < 1e-15) {
            /* 无法拟合（所有 x 相同） */
            a = 0; b = my; r2 = 0;
            regLabel = '无法拟合回归线（分组数 < 2）';
        } else {
            a = num / den;
            b = my - a * mx;
            var predicted = allX.map(function (x) { return a * x + b; });
            r2 = BioAssay.rSquared(allY, predicted);
            regLabel = 'y = ' + BioAssay.fmt(a, 4) + 'x + ' + BioAssay.fmt(b, 4) +
                       '  (R² = ' + BioAssay.fmt(r2, 4) + ')';
        }

        /* 回归线两端点（延伸至数据范围外 10%） */
        var xMin = 0;
        var xMax = groups.length - 1;
        var pad  = (xMax - xMin) * 0.1 + 0.1;
        var linePts = [
            { x: xMin - pad, y: a * (xMin - pad) + b },
            { x: xMax + pad, y: a * (xMax + pad) + b }
        ];

        datasets.push({
            label:       regLabel,
            data:        linePts,
            borderColor: BRAND,
            backgroundColor: BRAND,
            borderWidth: 2,
            pointRadius: 0,
            showLine:    true,
            tension:     0
        });

        var opts = Object.assign({}, BioAssay.chartDefaults, {
            scales: {
                x: {
                    type:  'linear',
                    title: { display: true, text: '分组序号' },
                    grid:  { color: 'rgba(0,0,0,0.06)' }
                },
                y: {
                    type:  'linear',
                    title: { display: true, text: '数值' },
                    grid:  { color: 'rgba(0,0,0,0.06)' }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (ctx) {
                            return ctx.dataset.label + ': (' +
                                   BioAssay.fmt(ctx.parsed.x, 2) + ', ' +
                                   BioAssay.fmt(ctx.parsed.y, 4) + ')';
                        }
                    }
                }
            }
        });

        BioAssay.renderChart('statsChart', {
            type: 'scatter',
            data: { datasets: datasets },
            options: opts
        });
    }

    /**
     * 渲染箱线图
     * 每组绘制一个箱体 (Q1~Q3)，中位线、须线 (min~Q1, Q3~max) 由插件补充
     * @param {Array<{name,values}>} groups 分组数据
     */
    function renderBoxChart(groups) {
        var labels = groups.map(function (g) { return g.name; });

        /* 构造箱线图数据 */
        boxPlotData = groups.map(function (g) {
            return {
                min:    Math.min.apply(null, g.values),
                q1:     BioAssay.quantile(g.values, 0.25),
                median: BioAssay.median(g.values),
                q3:     BioAssay.quantile(g.values, 0.75),
                max:    Math.max.apply(null, g.values)
            };
        });

        /* 浮动柱状图：[Q1, Q3] 绘制箱体 */
        var boxBars = boxPlotData.map(function (b) { return [b.q1, b.q3]; });

        var opts = Object.assign({}, BioAssay.chartDefaults, {
            scales: {
                x: { grid: { color: 'rgba(0,0,0,0.06)' }, title: { display: true, text: '分组' } },
                y: { grid: { color: 'rgba(0,0,0,0.06)' }, title: { display: true, text: '数值' } }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (ctx) {
                            var b = boxPlotData[ctx.dataIndex];
                            return [
                                '最大值 = ' + BioAssay.fmt(b.max, 4),
                                'Q3 = ' + BioAssay.fmt(b.q3, 4),
                                '中位数 = ' + BioAssay.fmt(b.median, 4),
                                'Q1 = ' + BioAssay.fmt(b.q1, 4),
                                '最小值 = ' + BioAssay.fmt(b.min, 4)
                            ];
                        }
                    }
                }
            }
        });

        BioAssay.renderChart('statsChart', {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label:           '箱线图 (Q1~Q3)',
                    data:            boxBars,
                    backgroundColor: groups.map(function (_, i) {
                        return FILL_COLORS[i % FILL_COLORS.length];
                    }),
                    borderColor: groups.map(function (_, i) {
                        return BORDER_COLORS[i % BORDER_COLORS.length];
                    }),
                    borderWidth:      1,
                    barPercentage:    0.5,
                    categoryPercentage: 0.7
                }]
            },
            options: opts,
            plugins: [boxPlotPlugin]
        });
    }

    /**
     * 渲染折线图（时间序列）
     * 每组一条折线，X 轴 = 序号 (1, 2, 3, ...)，Y 轴 = 数值
     * @param {Array<{name,values}>} groups 分组数据
     */
    function renderLineChart(groups) {
        /* 取最大数据长度作为 X 轴标签数 */
        var maxLen = 0;
        groups.forEach(function (g) {
            if (g.values.length > maxLen) maxLen = g.values.length;
        });

        var labels = [];
        for (var i = 1; i <= maxLen; i++) labels.push(String(i));

        var datasets = groups.map(function (g, gi) {
            return {
                label:           g.name,
                data:            g.values,
                borderColor:     BORDER_COLORS[gi % BORDER_COLORS.length],
                backgroundColor: FILL_COLORS[gi % FILL_COLORS.length],
                borderWidth:     2,
                pointRadius:     4,
                pointHoverRadius: 6,
                tension:         0.2,
                fill:            false
            };
        });

        var opts = Object.assign({}, BioAssay.chartDefaults, {
            scales: {
                x: { grid: { color: 'rgba(0,0,0,0.06)' }, title: { display: true, text: '序号' } },
                y: { grid: { color: 'rgba(0,0,0,0.06)' }, title: { display: true, text: '数值' } }
            },
            plugins: {
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            }
        });

        BioAssay.renderChart('statsChart', {
            type: 'line',
            data: { labels: labels, datasets: datasets },
            options: opts
        });
    }

    /* ============================================================
     * 结果表格渲染
     * ============================================================ */

    /**
     * 渲染描述性统计表格
     * @param {Array<{name,values}>} groups 分组数据
     * @returns {string} HTML 表格字符串
     */
    function renderDescTable(groups) {
        var headers = ['分组', 'N', '均值', 'SD', 'SEM', 'CV(%)', '中位数', '最小值', '最大值', 'Q1', 'Q3'];
        var rows = groups.map(function (g) {
            var d = descriptive(g.values);
            return [
                g.name,
                String(d.n),
                BioAssay.fmt(d.mean, 4),
                BioAssay.fmt(d.sd, 4),
                BioAssay.fmt(d.sem, 4),
                BioAssay.fmt(d.cv, 2),
                BioAssay.fmt(d.median, 4),
                BioAssay.fmt(d.min, 4),
                BioAssay.fmt(d.max, 4),
                BioAssay.fmt(d.q1, 4),
                BioAssay.fmt(d.q3, 4)
            ];
        });

        return '<h4>描述性统计</h4>' + BioAssay.table(headers, rows);
    }

    /**
     * 渲染统计检验结果
     * @param {Object} result 检验结果对象
     * @returns {string} HTML 字符串
     */
    function renderTestResult(result) {
        if (!result) return '';

        var html = '<h4>统计检验结果</h4>';

        if (result.test.indexOf('ANOVA') !== -1) {
            /* ANOVA 结果表 */
            var rows = [
                ['F 统计量',    BioAssay.fmt(result.statistic, 4)],
                ['df (组间)',   String(result.df1)],
                ['df (组内)',   String(result.df2)],
                ['SSB (组间平方和)', BioAssay.fmt(result.ssb, 4)],
                ['SSW (组内平方和)', BioAssay.fmt(result.ssw, 4)],
                ['MSB (组间均方)',   BioAssay.fmt(result.msb, 4)],
                ['MSW (组内均方)',   BioAssay.fmt(result.msw, 4)],
                ['p 值',        fmtP(result.pValue)],
                ['显著性',      sigStars(result.pValue)]
            ];
            html += BioAssay.table(['参数', '值'], rows);
        } else {
            /* t 检验结果表 */
            var rows = [
                ['t 统计量',  BioAssay.fmt(result.statistic, 4)],
                ['自由度 df', BioAssay.fmt(result.df, 2)],
                ['p 值',      fmtP(result.pValue)],
                ['显著性',    sigStars(result.pValue)]
            ];

            if (result.meanDiff !== undefined) {
                rows.push(['均值差', BioAssay.fmt(result.meanDiff, 4)]);
            }
            if (result.sdDiff !== undefined) {
                rows.push(['差值标准差', BioAssay.fmt(result.sdDiff, 4)]);
            }
            if (result.n !== undefined) {
                rows.push(['配对数 n', String(result.n)]);
            }
            if (result.n1 !== undefined) {
                rows.push(['n₁', String(result.n1)]);
                rows.push(['n₂', String(result.n2)]);
            }

            html += BioAssay.table(['参数', '值'], rows);
        }

        /* 显著性说明 */
        var sig = sigStars(result.pValue);
        var sigDesc;
        if (sig === '***')      sigDesc = '差异极显著 (p < 0.001)';
        else if (sig === '**')  sigDesc = '差异极显著 (p < 0.01)';
        else if (sig === '*')   sigDesc = '差异显著 (p < 0.05)';
        else                    sigDesc = '差异不显著 (p ≥ 0.05)';

        html += BioAssay.infoBox(result.test + '：' + sigDesc + ' ' + sig);

        return html;
    }

    /* ============================================================
     * 主流程
     * ============================================================ */

    /** 执行统计分析与作图 */
    function doAnalyze() {
        /* 重置插件数据 */
        errorBarData = [];
        boxPlotData  = [];

        /* 解析数据 */
        var dataText = els.data.value.trim();
        if (!dataText) {
            els.result.innerHTML = BioAssay.errorBox('请输入数据');
            return;
        }

        var groups = parseGroups(dataText);
        if (!groups || groups.length === 0) {
            els.result.innerHTML = BioAssay.errorBox('未能解析到有效数据，请检查输入格式');
            return;
        }

        /* 校验每组至少有 1 个数值 */
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].values.length < 1) {
                els.result.innerHTML = BioAssay.errorBox('分组 "' + groups[i].name + '" 没有有效数值');
                return;
            }
        }

        var chartType  = els.chartType.value;
        var errorType  = els.errorType.value;
        var testType   = els.testType.value;

        /* 更新图表标题 */
        if (els.chartTitle && TITLES[chartType]) {
            els.chartTitle.textContent = TITLES[chartType];
        }

        /* 渲染图表 */
        if (chartType === 'bar') {
            renderBarChart(groups, errorType);
        } else if (chartType === 'scatter') {
            renderScatterChart(groups);
        } else if (chartType === 'box') {
            renderBoxChart(groups);
        } else {
            renderLineChart(groups);
        }

        /* 构建结果 HTML */
        var html = renderDescTable(groups);

        /* 执行统计检验 */
        var testResult = null;
        if (testType === 'ttest-paired') {
            if (groups.length < 2) {
                html += BioAssay.errorBox('配对 t 检验需要至少 2 组数据');
            } else {
                testResult = pairedTTest(groups[0].values, groups[1].values);
                if (!testResult) {
                    html += BioAssay.errorBox('配对 t 检验失败：两组数据长度均需 ≥ 2 且差值标准差不为零');
                }
            }
        } else if (testType === 'ttest-unpaired') {
            if (groups.length < 2) {
                html += BioAssay.errorBox('非配对 t 检验需要至少 2 组数据');
            } else {
                testResult = unpairedTTest(groups[0].values, groups[1].values);
                if (!testResult) {
                    html += BioAssay.errorBox('非配对 t 检验失败：两组数据长度均需 ≥ 2 且合并方差不为零');
                }
            }
        } else if (testType === 'anova') {
            if (groups.length < 2) {
                html += BioAssay.errorBox('ANOVA 需要至少 2 组数据');
            } else {
                testResult = anovaTest(groups);
                if (!testResult) {
                    html += BioAssay.errorBox('ANOVA 失败：请确保总样本量大于组数且组内方差不为零');
                }
            }
        }

        if (testResult) {
            html += renderTestResult(testResult);
        }

        els.result.innerHTML = html;
    }

    /** 清空所有输入与结果 */
    function doClear() {
        els.data.value = '';
        els.result.innerHTML = '';
        errorBarData = [];
        boxPlotData  = [];
        BioAssay.destroyChart('statsChart');
        /* 恢复默认标题 */
        if (els.chartTitle) els.chartTitle.textContent = '统计图表';
        /* 恢复默认选项 */
        if (els.chartType) els.chartType.value = 'bar';
        if (els.errorType) els.errorType.value = 'sd';
        if (els.testType)  els.testType.value = 'none';
    }

    /** 导出当前图表为 PNG */
    function doExport() {
        var canvas = document.getElementById('statsChart');
        if (!canvas || !canvas.__chart) {
            els.result.innerHTML = BioAssay.errorBox('请先生成图表再导出') + els.result.innerHTML;
            return;
        }

        /* 生成 PNG 数据 URL 并触发下载 */
        var url = canvas.__chart.toBase64Image();
        var link = document.createElement('a');
        link.download = '统计图表.png';
        link.href = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /* ============================================================
     * 事件绑定
     * ============================================================ */
    if (els.analyzeBtn) els.analyzeBtn.addEventListener('click', doAnalyze);
    if (els.clearBtn)   els.clearBtn.addEventListener('click', doClear);
    if (els.exportBtn)  els.exportBtn.addEventListener('click', doExport);

    /* 图表类型切换时即时更新标题 */
    if (els.chartType) {
        els.chartType.addEventListener('change', function () {
            var ct = els.chartType.value;
            if (els.chartTitle && TITLES[ct]) {
                els.chartTitle.textContent = TITLES[ct];
            }
        });
    }

})();
