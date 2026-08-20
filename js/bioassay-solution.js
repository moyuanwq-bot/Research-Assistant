// AI生成
/**
 * bioassay-solution.js — 溶液配制计算器模块
 *
 * 依赖（全局）：
 *   BioAssay — 辅助对象，提供以下方法：
 *     table(headers, rows)    生成 HTML 表格字符串
 *     fmt(v, decimals)        数字格式化
 *     errorBox(msg) / infoBox(msg)
 *
 * 计算模式：
 *   dilution — 稀释计算 (C₁V₁ = C₂V₂)
 *   serial   — 系列稀释生成
 *   buffer   — 缓冲液配方
 *   mw       — 分子量计算
 */
(function () {
    'use strict';

    /* ============================================================
     * DOM 元素引用
     * ============================================================ */
    var els = {
        mode:       document.getElementById('solMode'),
        dilution:   document.getElementById('sol-dilution'),
        serial:     document.getElementById('sol-serial'),
        buffer:     document.getElementById('sol-buffer'),
        mw:         document.getElementById('sol-mw'),
        result:     document.getElementById('solResult'),
        /* 稀释计算 */
        dilC1:      document.getElementById('dilC1'),
        dilC2:      document.getElementById('dilC2'),
        dilV2:      document.getElementById('dilV2'),
        dilUnit:    document.getElementById('dilUnit'),
        dilCalcBtn: document.getElementById('dilCalcBtn'),
        /* 系列稀释 */
        serStart:   document.getElementById('serStart'),
        serFactor:  document.getElementById('serFactor'),
        serSteps:   document.getElementById('serSteps'),
        serVol:     document.getElementById('serVol'),
        serCalcBtn: document.getElementById('serCalcBtn'),
        /* 缓冲液配方 */
        bufType:    document.getElementById('bufType'),
        bufVol:     document.getElementById('bufVol'),
        bufConc:    document.getElementById('bufConc'),
        bufPH:      document.getElementById('bufPH'),
        bufCalcBtn: document.getElementById('bufCalcBtn'),
        /* 分子量计算 */
        mwType:     document.getElementById('mwType'),
        mwInput:    document.getElementById('mwInput'),
        mwCalcBtn:  document.getElementById('mwCalcBtn')
    };

    /* ============================================================
     * 常量数据
     * ============================================================ */

    /* 氨基酸平均残基分子量 (Da) */
    var AA_WEIGHTS = {
        A: 71.08,  R: 156.19, N: 114.10, D: 115.09, C: 103.14,
        E: 129.12, Q: 128.13, G: 57.05,  H: 137.14, I: 113.16,
        L: 113.16, K: 128.17, M: 131.19, F: 147.18, P: 97.12,
        S: 87.08,  T: 101.10, W: 186.21, Y: 163.18, V: 99.13
    };

    /* 氨基酸侧链可电离基团 pKa 值（用于等电点估算） */
    var AA_PKAS = {
        D: 3.65,   /* Asp β-羧基 */
        E: 4.25,   /* Glu γ-羧基 */
        C: 8.33,   /* Cys 巯基 */
        Y: 10.07,  /* Tyr 酚羟基 */
        H: 6.00,   /* His 咪唑基 */
        K: 10.53,  /* Lys ε-氨基 */
        R: 12.48   /* Arg 胍基 */
    };

    /* 末端 pKa 近似值 */
    var N_TERM_PKA = 9.0;   /* N-末端 α-氨基 */
    var C_TERM_PKA = 2.0;   /* C-末端 α-羧基 */

    /* 水的分子量 (Da)，用于肽链末端 */
    var WATER_MW = 18.02;

    /* 元素原子量 (g/mol) */
    var ATOMIC_WEIGHTS = {
        H: 1.008,   C: 12.011,  N: 14.007,  O: 15.999,  P: 30.974,
        S: 32.06,   Na: 22.990, K: 39.098,  Cl: 35.45,  Ca: 40.078,
        Mg: 24.305, Fe: 55.845, Zn: 65.38,  Cu: 63.546, Mn: 54.938,
        F: 18.998,  Br: 79.904, I: 126.904, B: 10.81,   Si: 28.086
    };

    /* ============================================================
     * 界面切换
     * ============================================================ */

    /**
     * 计算模式切换
     * 显示对应子面板，隐藏其余，并清空结果区
     */
    function onModeChange() {
        var mode = els.mode.value;
        var panels = {
            dilution: els.dilution,
            serial:   els.serial,
            buffer:   els.buffer,
            mw:       els.mw
        };
        for (var key in panels) {
            if (panels[key]) panels[key].hidden = (key !== mode);
        }
        els.result.innerHTML = '';
    }

    /* ============================================================
     * 1. 稀释计算 (C₁V₁ = C₂V₂)
     * ============================================================ */

    /**
     * 执行稀释计算
     * 公式：V₁ = C₂ × V₂ / C₁
     * 稀释剂体积 = V₂ − V₁
     */
    function doDilution() {
        var c1   = parseFloat(els.dilC1.value);
        var c2   = parseFloat(els.dilC2.value);
        var v2   = parseFloat(els.dilV2.value);
        var unit = els.dilUnit.value;

        /* ---- 输入校验 ---- */
        if (isNaN(c1) || c1 <= 0) {
            els.result.innerHTML = BioAssay.errorBox('请输入有效的初始浓度 C₁（正数）');
            return;
        }
        if (isNaN(c2) || c2 <= 0) {
            els.result.innerHTML = BioAssay.errorBox('请输入有效的目标浓度 C₂（正数）');
            return;
        }
        if (isNaN(v2) || v2 <= 0) {
            els.result.innerHTML = BioAssay.errorBox('请输入有效的目标体积 V₂（正数）');
            return;
        }

        /* ---- 目标浓度高于母液时无法通过稀释达到 ---- */
        if (c2 > c1) {
            els.result.innerHTML = BioAssay.errorBox(
                '目标浓度 C₂ 大于初始浓度 C₁，无法通过稀释达到，请检查输入。'
            );
            return;
        }

        /* ---- 计算 ---- */
        var v1      = c2 * v2 / c1;   /* 母液体积 (mL) */
        var diluent = v2 - v1;         /* 稀释剂体积 (mL) */
        var fold    = c1 / c2;         /* 稀释倍数 */

        /* ---- 渲染结果 ---- */
        var html = '';

        /* 文字描述 */
        html += BioAssay.infoBox(
            '取 <strong>' + BioAssay.fmt(v1, 4) + '</strong> mL 浓度为 ' +
            BioAssay.fmt(c1, 4) + ' ' + unit + ' 的母液，加入 <strong>' +
            BioAssay.fmt(diluent, 4) + '</strong> mL 稀释剂，定容至 ' +
            BioAssay.fmt(v2, 4) + ' mL'
        );

        /* 结果表格 */
        html += '<h4>稀释计算结果</h4>';
        html += BioAssay.table(
            ['母液体积 (mL)', '稀释剂体积 (mL)', '总体积 (mL)', '最终浓度'],
            [
                [
                    BioAssay.fmt(v1, 4),
                    BioAssay.fmt(diluent, 4),
                    BioAssay.fmt(v2, 4),
                    BioAssay.fmt(c2, 4) + ' ' + unit
                ]
            ]
        );

        /* 稀释倍数提示 */
        html += BioAssay.infoBox(
            '稀释倍数: ' + BioAssay.fmt(fold, 4) + '×'
        );

        els.result.innerHTML = html;
    }

    /* ============================================================
     * 2. 系列稀释生成
     * ============================================================ */

    /**
     * 生成系列稀释方案
     * 每步将上一步溶液按 1/factor 取样，加稀释剂补足至每步总体积
     * 第 0 步为起始母液，第 1～N 步逐级稀释
     */
    function doSerial() {
        var start  = parseFloat(els.serStart.value);
        var factor = parseFloat(els.serFactor.value);
        var steps  = parseInt(els.serSteps.value, 10);
        var vol    = parseFloat(els.serVol.value);

        /* ---- 输入校验 ---- */
        if (isNaN(start) || start <= 0) {
            els.result.innerHTML = BioAssay.errorBox('请输入有效的起始浓度（正数）');
            return;
        }
        if (isNaN(factor) || factor <= 1) {
            els.result.innerHTML = BioAssay.errorBox('稀释倍数需大于 1');
            return;
        }
        if (isNaN(steps) || steps < 1) {
            els.result.innerHTML = BioAssay.errorBox('稀释步数需至少为 1');
            return;
        }
        if (isNaN(vol) || vol <= 0) {
            els.result.innerHTML = BioAssay.errorBox('请输入有效的每步体积（正数）');
            return;
        }

        /* ---- 生成各步数据 ---- */
        var sampleVol  = vol / factor;    /* 每步取样体积 (μL) */
        var diluentVol = vol - sampleVol;  /* 每步稀释剂体积 (μL) */

        var rows = [];
        for (var i = 0; i <= steps; i++) {
            var conc = start / Math.pow(factor, i);
            if (i === 0) {
                /* 第 0 步为起始母液，无需取样与稀释 */
                rows.push([
                    '0 (母液)',
                    BioAssay.fmt(conc, 6),
                    '—',
                    '—',
                    BioAssay.fmt(vol, 4)
                ]);
            } else {
                rows.push([
                    String(i),
                    BioAssay.fmt(conc, 6),
                    BioAssay.fmt(sampleVol, 4),
                    BioAssay.fmt(diluentVol, 4),
                    BioAssay.fmt(vol, 4)
                ]);
            }
        }

        /* ---- 渲染结果 ---- */
        var html = '';
        html += '<h4>系列稀释方案</h4>';
        html += BioAssay.table(
            ['步骤', '浓度', '取样体积 (μL)', '稀释剂体积 (μL)', '总体积 (μL)'],
            rows
        );

        /* 操作说明 */
        html += BioAssay.infoBox(
            '每步取 ' + BioAssay.fmt(sampleVol, 4) + ' μL 上一步溶液，' +
            '加 ' + BioAssay.fmt(diluentVol, 4) + ' μL 稀释剂，' +
            '混匀后得到下一步溶液（总体积 ' + BioAssay.fmt(vol, 4) + ' μL）。' +
            '稀释倍数: ' + BioAssay.fmt(factor, 4) + '×'
        );

        els.result.innerHTML = html;
    }

    /* ============================================================
     * 3. 缓冲液配方计算
     * ============================================================ */

    /**
     * 执行缓冲液配方计算
     * 根据缓冲液类型与配制体积，计算各组分需称量质量
     * 质量 (g) = 浓度 (mM) × 分子量 (g/mol) × 体积 (L) / 1000
     */
    function doBuffer() {
        var type = els.bufType.value;
        var vol  = parseFloat(els.bufVol.value);   /* mL */

        /* ---- 输入校验 ---- */
        if (isNaN(vol) || vol <= 0) {
            els.result.innerHTML = BioAssay.errorBox('请输入有效的配制体积（正数）');
            return;
        }

        var volL       = vol / 1000;   /* 转为升 */
        var components = [];            /* [{name, conc, mw}] */
        var notes      = '';
        var ph         = null;
        var bufName    = '';
        var tweenVol   = null;          /* Tween-20 体积 (mL)，仅 TBST */

        if (type === 'pbs') {
            /* PBS (pH 7.4): 137 mM NaCl, 2.7 mM KCl, 10 mM Na₂HPO₄, 1.8 mM KH₂PO₄ */
            bufName = 'PBS (磷酸盐缓冲液)';
            ph = 7.4;
            components = [
                { name: 'NaCl',      conc: 137,  mw: 58.44  },
                { name: 'KCl',       conc: 2.7,  mw: 74.55  },
                { name: 'Na₂HPO₄',  conc: 10,   mw: 141.96 },
                { name: 'KH₂PO₄',   conc: 1.8,  mw: 136.09 }
            ];
            notes = '将各组分溶于蒸馏水，调 pH 至 7.4，定容至 ' +
                    BioAssay.fmt(vol, 0) + ' mL。';
        } else if (type === 'tbs') {
            /* TBS (pH 7.6): 50 mM Tris, 150 mM NaCl */
            bufName = 'TBS (Tris 缓冲盐溶液)';
            ph = 7.6;
            components = [
                { name: 'Tris',  conc: 50,  mw: 121.14 },
                { name: 'NaCl',  conc: 150, mw: 58.44  }
            ];
            notes = '将 Tris 与 NaCl 溶于蒸馏水，用 HCl 调 pH 至 7.6，定容至 ' +
                    BioAssay.fmt(vol, 0) + ' mL。';
        } else if (type === 'tris') {
            /* Tris-HCl: 用户指定浓度，用 HCl 调 pH */
            bufName = 'Tris-HCl 缓冲液';
            var conc = parseFloat(els.bufConc.value);
            if (isNaN(conc) || conc <= 0) {
                els.result.innerHTML = BioAssay.errorBox('请输入有效的 Tris 浓度（正数）');
                return;
            }
            ph = parseFloat(els.bufPH.value);
            components = [
                { name: 'Tris base', conc: conc, mw: 121.14 }
            ];
            notes = '称取 Tris base 溶于蒸馏水，用 HCl 调节至目标 pH' +
                    (!isNaN(ph) ? ' ' + BioAssay.fmt(ph, 2) : '') +
                    '，定容至 ' + BioAssay.fmt(vol, 0) + ' mL。';
        } else if (type === 'hepes') {
            /* HEPES: 用户指定浓度，用 NaOH 或 HCl 调 pH */
            bufName = 'HEPES 缓冲液';
            var conc = parseFloat(els.bufConc.value);
            if (isNaN(conc) || conc <= 0) {
                els.result.innerHTML = BioAssay.errorBox('请输入有效的 HEPES 浓度（正数）');
                return;
            }
            ph = parseFloat(els.bufPH.value);
            components = [
                { name: 'HEPES (free acid)', conc: conc, mw: 238.30 }
            ];
            notes = '称取 HEPES (free acid) 溶于蒸馏水，用 NaOH 或 HCl 调节至目标 pH' +
                    (!isNaN(ph) ? ' ' + BioAssay.fmt(ph, 2) : '') +
                    '，定容至 ' + BioAssay.fmt(vol, 0) + ' mL。' +
                    '（亦可用 HEPES sodium salt，MW = 260.29 g/mol）';
        } else if (type === 'tbst') {
            /* TBST: TBS + 0.1% Tween-20 */
            bufName = 'TBST (TBS + Tween-20)';
            ph = 7.6;
            components = [
                { name: 'Tris',  conc: 50,  mw: 121.14 },
                { name: 'NaCl',  conc: 150, mw: 58.44  }
            ];
            tweenVol = vol * 0.001;   /* 0.1% v/v → mL */
            notes = '先配制 TBS 并调 pH 至 7.6，加入 ' +
                    BioAssay.fmt(tweenVol, 4) + ' mL Tween-20，' +
                    '定容至 ' + BioAssay.fmt(vol, 0) + ' mL，混匀。';
        }

        /* ---- 计算各组分称量质量并生成表格行 ---- */
        var rows = components.map(function (c) {
            var mass = c.conc * c.mw * volL / 1000;   /* g */
            return [
                c.name,
                BioAssay.fmt(c.conc, 2) + ' mM',
                BioAssay.fmt(c.mw, 2),
                BioAssay.fmt(mass, 4) + ' g'
            ];
        });

        /* ---- 渲染结果 ---- */
        var html = '';
        html += '<h4>' + bufName + ' 配方</h4>';
        html += BioAssay.table(
            ['组分', '浓度', '分子量 (g/mol)', '需称量'],
            rows
        );

        /* TBST 额外显示 Tween-20 加入量 */
        if (tweenVol !== null) {
            html += BioAssay.infoBox(
                'Tween-20: 加入 <strong>' + BioAssay.fmt(tweenVol, 4) +
                ' mL</strong>（0.1% v/v）'
            );
        }

        /* 总体积与 pH 汇总 */
        var summary = '总体积: ' + BioAssay.fmt(vol, 2) + ' mL';
        if (ph !== null && !isNaN(ph)) {
            summary += '，目标 pH: ' + BioAssay.fmt(ph, 2);
        }
        html += BioAssay.infoBox(summary);

        /* 配制说明 */
        html += BioAssay.infoBox(notes);

        els.result.innerHTML = html;
    }

    /* ============================================================
     * 4. 分子量计算
     * ============================================================ */

    /**
     * 计算给定 pH 下多肽的净电荷
     * 酸性基团贡献负电荷，碱性基团贡献正电荷
     * @param {string} seq  氨基酸序列（大写单字母）
     * @param {number} pH   pH 值
     * @returns {number} 净电荷
     */
    function peptideNetCharge(seq, pH) {
        var charge = 0;
        /* N-末端 α-氨基（碱性） */
        charge += 1 / (1 + Math.pow(10, pH - N_TERM_PKA));
        /* C-末端 α-羧基（酸性） */
        charge -= 1 / (1 + Math.pow(10, C_TERM_PKA - pH));
        /* 各残基侧链 */
        for (var i = 0; i < seq.length; i++) {
            var aa  = seq[i];
            var pka = AA_PKAS[aa];
            if (!pka) continue;
            if (aa === 'D' || aa === 'E' || aa === 'C' || aa === 'Y') {
                /* 酸性侧链：去质子化后带负电 */
                charge -= 1 / (1 + Math.pow(10, pka - pH));
            } else {
                /* 碱性侧链 (H, K, R)：质子化后带正电 */
                charge += 1 / (1 + Math.pow(10, pH - pka));
            }
        }
        return charge;
    }

    /**
     * 二分法估算等电点 pI（净电荷 = 0 时的 pH）
     * @param {string} seq  氨基酸序列
     * @returns {number} pI 估算值
     */
    function estimatePI(seq) {
        var lo = 0, hi = 14;
        for (var iter = 0; iter < 100; iter++) {
            var mid = (lo + hi) / 2;
            if (peptideNetCharge(seq, mid) > 0) lo = mid;
            else hi = mid;
        }
        return (lo + hi) / 2;
    }

    /**
     * 解析化学式，返回各元素原子数
     * 格式：元素符号（大写字母 + 可选小写字母）+ 可选数字
     * @param {string} formula  化学式，如 "C6H12O6"、"NaCl"
     * @returns {{elements:Object|null, error:string|null}}
     */
    function parseFormula(formula) {
        var regex   = /([A-Z][a-z]?)(\d*)/g;
        var elements = {};
        var match;
        var consumed = 0;
        while ((match = regex.exec(formula)) !== null) {
            var symbol = match[1];
            var count  = match[2] ? parseInt(match[2], 10) : 1;
            if (!ATOMIC_WEIGHTS[symbol]) {
                return { error: '未知元素: ' + symbol, elements: null };
            }
            elements[symbol] = (elements[symbol] || 0) + count;
            consumed += match[0].length;
        }
        /* 消费长度不等于公式长度说明存在无法解析的字符 */
        if (consumed !== formula.length) {
            return { error: '化学式格式错误，请检查大小写与符号', elements: null };
        }
        return { elements: elements, error: null };
    }

    /**
     * 计算氨基酸序列分子量
     * MW = Σ(残基平均分子量) + 18.02 (末端 H₂O)
     * 同时估算等电点 pI 并统计氨基酸组成
     */
    function doMWAA() {
        var raw = els.mwInput.value.trim().toUpperCase().replace(/\s+/g, '');
        if (!raw) {
            els.result.innerHTML = BioAssay.errorBox('请输入氨基酸序列');
            return;
        }

        /* ---- 校验每个残基并累加分子量 ---- */
        var invalid = [];
        var totalWeight = 0;
        for (var i = 0; i < raw.length; i++) {
            var aa = raw[i];
            if (!AA_WEIGHTS[aa]) {
                invalid.push(aa);
            } else {
                totalWeight += AA_WEIGHTS[aa];
            }
        }

        if (invalid.length) {
            els.result.innerHTML = BioAssay.errorBox(
                '序列中包含无效的氨基酸代码: ' + invalid.join(', ') +
                '。请使用单字母代码（A-R-N-D-C-E-Q-G-H-I-L-K-M-F-P-S-T-W-Y-V）。'
            );
            return;
        }

        var n  = raw.length;
        var mw = totalWeight + WATER_MW;   /* 加上末端水分子 */
        var pI = estimatePI(raw);

        /* ---- 统计氨基酸组成 ---- */
        var composition = {};
        for (var j = 0; j < raw.length; j++) {
            var code = raw[j];
            composition[code] = (composition[code] || 0) + 1;
        }
        var compStr = Object.keys(composition).sort().map(function (code) {
            return code + ':' + composition[code];
        }).join('  ');

        /* ---- 渲染结果 ---- */
        var html = '';
        html += '<h4>氨基酸序列分子量</h4>';
        html += BioAssay.table(
            ['参数', '值', '说明'],
            [
                ['分子量',    BioAssay.fmt(mw, 2) + ' Da', '含末端水分子'],
                ['残基数',    String(n),                   '氨基酸残基个数'],
                ['等电点 pI', BioAssay.fmt(pI, 2),         '估算值（基于侧链 pKa）']
            ]
        );

        /* 氨基酸组成 */
        html += '<h4>氨基酸组成</h4>';
        html += BioAssay.infoBox(compStr);

        /* 说明 */
        html += BioAssay.infoBox(
            '分子量 = Σ(残基平均分子量) + 18.02 (H₂O)。' +
            '等电点 pI 基于各可电离侧链 pKa 值，' +
            '通过二分法求解净电荷 = 0 时的 pH，为近似估算。'
        );

        els.result.innerHTML = html;
    }

    /**
     * 计算化学式分子量
     * 解析化学式中各元素及其原子数，乘以原子量求和
     */
    function doMWFormula() {
        var formula = els.mwInput.value.trim();
        if (!formula) {
            els.result.innerHTML = BioAssay.errorBox('请输入化学式');
            return;
        }

        var parsed = parseFormula(formula);
        if (parsed.error) {
            els.result.innerHTML = BioAssay.errorBox(parsed.error);
            return;
        }

        /* ---- 逐元素计算贡献 ---- */
        var elements = parsed.elements;
        var totalMW  = 0;
        var rows     = [];
        var symbols  = Object.keys(elements).sort();
        for (var i = 0; i < symbols.length; i++) {
            var sym   = symbols[i];
            var count = elements[sym];
            var aw    = ATOMIC_WEIGHTS[sym];
            var sub   = count * aw;
            totalMW += sub;
            rows.push([
                sym,
                String(count),
                BioAssay.fmt(aw, 3),
                BioAssay.fmt(sub, 3)
            ]);
        }

        /* ---- 渲染结果 ---- */
        var html = '';
        html += '<h4>化学式分子量: ' + formula + '</h4>';
        html += BioAssay.table(
            ['元素', '原子数', '原子量 (g/mol)', '小计 (g/mol)'],
            rows
        );

        /* 总分子量 */
        html += BioAssay.infoBox(
            '总分子量 = <strong>' + BioAssay.fmt(totalMW, 3) + ' g/mol</strong>'
        );

        els.result.innerHTML = html;
    }

    /**
     * 分子量计算主入口
     * 根据输入类型分派至氨基酸序列或化学式计算
     */
    function doMW() {
        var type = els.mwType.value;
        if (type === 'aa') {
            doMWAA();
        } else {
            doMWFormula();
        }
    }

    /* ============================================================
     * 事件绑定
     * ============================================================ */
    if (els.mode)       els.mode.addEventListener('change', onModeChange);
    if (els.dilCalcBtn) els.dilCalcBtn.addEventListener('click', doDilution);
    if (els.serCalcBtn) els.serCalcBtn.addEventListener('click', doSerial);
    if (els.bufCalcBtn) els.bufCalcBtn.addEventListener('click', doBuffer);
    if (els.mwCalcBtn)  els.mwCalcBtn.addEventListener('click', doMW);

})();
