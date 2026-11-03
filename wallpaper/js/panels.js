/* PerfTicker 壁纸 · 各面板绘制 */
(function () {
  const PT = window.PT, C = PT.C, F = PT.font;

  PT.tickOf = function (S) { return (S.connected && S.tick) ? S.tick : S.demo; };

  /* 顶部标题栏 */
  PT.drawTitleBar = function (ctx, r, S) {
    const t = PT.tickOf(S);
    ctx.save();
    PT.rr(ctx, r.x, r.y, r.w, r.h, 10);
    const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    g.addColorStop(0, '#141923'); g.addColorStop(1, '#0b0e15');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = C.line; ctx.stroke();

    // 左侧品牌
    const cy = r.y + r.h / 2;
    const lx = r.x + 18;
    ctx.fillStyle = C.gold;
    PT.rr(ctx, lx, cy - 11, 22, 22, 6); ctx.fill();
    PT.text(ctx, 'P', lx + 11, cy + 1, '700 15px ' + F.num, '#0a0d13', 'center');
    PT.text(ctx, 'PerfTicker', lx + 32, cy - 7, '700 19px ' + F.ui, C.textHi);
    PT.text(ctx, 'A 股行情终端 · 壁纸版', lx + 33, cy + 11, '11px ' + F.ui, C.dim);

    // 中部 CPU / GPU
    const cx = r.x + r.w * 0.46;
    ctx.textAlign = 'center';
    PT.text(ctx, (S.hello ? S.hello.cpu : (t && t.cpuName) || 'CPU'), cx, cy - 8, '600 13px ' + F.ui, C.txtHi2, 'center');
    const gpuName = (S.hello && S.hello.gpu) || (t && t.gpu && t.gpu.name) || '图形处理器';
    PT.text(ctx, gpuName, cx, cy + 10, '11px ' + F.ui, C.dim, 'center');

    // 右侧状态 + 时钟
    const rx = r.x + r.w - 18;
    const d = new Date(S.clock || Date.now());
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    PT.text(ctx, hh + ':' + mm + ':' + ss, rx, cy - 7, '600 22px ' + F.mono, C.textHi, 'right');
    PT.text(ctx, d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), rx, cy + 13, '10px ' + F.mono, C.dim, 'right');

    // 连接状态胶囊
    const pillW = 74, pillH = 20, pillX = rx - 150, pillY = cy - pillH / 2;
    PT.rr(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fillStyle = S.connected ? 'rgba(0,192,139,0.14)' : 'rgba(255,169,64,0.14)'; ctx.fill();
    ctx.strokeStyle = S.connected ? C.down : C.warn; ctx.stroke();
    ctx.beginPath(); ctx.arc(pillX + 12, cy, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = S.connected ? C.down : C.warn; ctx.fill();
    PT.text(ctx, S.connected ? 'LIVE' : '离线演示', pillX + 22, cy + 1, '600 11px ' + F.mono, S.connected ? C.down : C.warn);
    ctx.restore();
  };

  /* 三大指数卡片 */
  PT.drawIndexCards = function (ctx, r, S, codes) {
    const t = PT.tickOf(S);
    const gap = 12;
    const n = codes.length;
    const cw = (r.w - gap * (n - 1)) / n;
    let metrics = (t && t.metrics) || [];
    for (let i = 0; i < n; i++) {
      const x = r.x + i * (cw + gap);
      PT.card(ctx, x, r.y, cw, r.h);
      const m = metrics.find(mm => mm.code === codes[i]) || {};
      const chg = m.chg || 0;
      const col = chg > 0.0001 ? C.up : chg < -0.0001 ? C.down : C.flat;
      PT.text(ctx, m.name || codes[i], x + 16, r.y + 20, '12px ' + F.ui, C.dim);
      // 大数值
      const dec = m.decimals === undefined ? 2 : m.decimals;
      PT.text(ctx, PT.fmt(m.value, dec), x + 16, r.y + r.h * 0.46, '700 ' + Math.round(r.h * 0.30) + 'px ' + F.num, C.textHi);
      const vw = ctx.measureText(PT.fmt(m.value, dec)).width;
      ctx.font = '12px ' + F.ui; ctx.fillStyle = C.dim; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(m.unit || '', x + 20 + vw, r.y + r.h * 0.46 + 4);
      // 涨跌
      const chgText = m.chgText || ((chg >= 0 ? '+' : '') + PT.fmt(chg, dec) + '  ' + (m.chgPct >= 0 ? '+' : '') + PT.fmt(m.chgPct || 0, 2) + '%');
      PT.text(ctx, chgText, x + 16, r.y + r.h * 0.70, '600 13px ' + F.num, col);
      // 走势
      if (m.spark && m.spark.length > 1) {
        PT.drawSpark(ctx, x + 12, r.y + r.h - 34, cw - 24, 26, m.spark, col);
      }
    }
  };

  /* 当前标的详情 */
  PT.drawInstrument = function (ctx, r, S) {
    const t = PT.tickOf(S);
    PT.card(ctx, r.x, r.y, r.w, r.h);
    const m = (t && t.selected) || {};
    PT.text(ctx, m.name || '—', r.x + 16, r.y + 22, '600 14px ' + F.ui, C.gold);
    PT.text(ctx, m.code || '', r.x + r.w - 16, r.y + 22, '12px ' + F.mono, C.dim, 'right');
    const dec = m.decimals === undefined ? 2 : m.decimals;
    const chg = m.chg || 0;
    const col = chg > 0.0001 ? C.up : chg < -0.0001 ? C.down : C.flat;
    PT.text(ctx, PT.fmt(m.value, dec), r.x + 16, r.y + r.h * 0.48, '700 ' + Math.round(r.h * 0.30) + 'px ' + F.num, C.textHi);
    const vw = ctx.measureText(PT.fmt(m.value, dec)).width;
    PT.text(ctx, m.unit || '', r.x + 20 + vw, r.y + r.h * 0.48 + 4, '13px ' + F.ui, C.dim);
    PT.text(ctx, (m.chgText || PT.fmtSigned(chg, dec)), r.x + 16, r.y + r.h * 0.74, '600 14px ' + F.num, col);
    // 高/低
    PT.text(ctx, '高 ' + PT.fmt(m.highPct === undefined ? 0 : m.highPct, 2) + '%', r.x + r.w * 0.55, r.y + r.h * 0.74, '11px ' + F.mono, C.dim);
    PT.text(ctx, '低 ' + PT.fmt(m.lowPct === undefined ? 0 : m.lowPct, 2) + '%', r.x + r.w * 0.78, r.y + r.h * 0.74, '11px ' + F.mono, C.dim);
  };

  /* 处理器核心网格 */
  PT.drawCores = function (ctx, r, S) {
    ctx.save();
    const t = PT.tickOf(S);
    PT.card(ctx, r.x, r.y, r.w, r.h);
    const pct = (t && t.coresPct) || [];
    PT.cardTitle(ctx, r.x + 16, r.y + 20, r.w - 32, '处理器核心', pct.length ? (pct.length + ' 核') : '');
    if (!pct.length) return;
    const top = r.y + 38, availH = r.h - 50;
    const cols = Math.min(12, Math.ceil(pct.length / 2));
    const rows = Math.ceil(pct.length / cols);
    const cellW = (r.w - 32) / cols;
    const cellH = availH / rows;
    for (let i = 0; i < pct.length; i++) {
      const c = i % cols, ro = Math.floor(i / cols);
      const x = r.x + 16 + c * cellW;
      const y = top + ro * cellH;
      const v = PT.clamp(pct[i] / 100, 0, 1);
      const bh = (cellH - 14) * v;
      // 轨道
      ctx.fillStyle = C.panelSoft;
      ctx.fillRect(x + 2, y + 2, cellW - 6, cellH - 12);
      // 值
      const col = v > 0.75 ? C.up : v > 0.4 ? C.warn : C.down;
      ctx.fillStyle = col;
      ctx.fillRect(x + 2, y + 2 + (cellH - 12 - bh), cellW - 6, bh);
      ctx.font = '9px ' + F.mono; ctx.fillStyle = C.dim; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(String(i + 1), x + cellW / 2, y + cellH - 11);
    }
    ctx.restore();
  };

  /* 五档盘口（活跃进程 Top） */
  PT.drawBook = function (ctx, r, S) {
    const t = PT.tickOf(S);
    PT.card(ctx, r.x, r.y, r.w, r.h);
    PT.cardTitle(ctx, r.x + 16, r.y + 20, r.w - 32, '五档盘口 · 活跃进程');
    const rows = ((t && t.book) || []).slice(0, 8);
    if (!rows.length) return;
    const top = r.y + 38, rowH = (r.h - 46) / rows.length;
    const maxCpu = Math.max(1, ...rows.map(p => p.cpu || 0));
    for (let i = 0; i < rows.length; i++) {
      const p = rows[i];
      const y = top + i * rowH;
      const cy = y + rowH / 2;
      PT.text(ctx, p.name || ('PID ' + p.pid), r.x + 16, cy - 6, '12px ' + F.ui, C.txt);
      PT.text(ctx, (p.mem >= 1024 ? (p.mem / 1024).toFixed(1) + 'G' : Math.round(p.mem || 0) + 'M'), r.x + 16, cy + 8, '10px ' + F.mono, C.fade);
      // 条
      const barX = r.x + r.w * 0.52, barW = r.w * 0.28;
      PT.hBar(ctx, barX, cy - 2.5, barW, 5, (p.cpu || 0) / maxCpu, (p.cpu > 20 ? C.up : C.gold));
      PT.text(ctx, PT.fmt(p.cpu, 1) + '%', r.x + r.w - 16, cy, '600 12px ' + F.num, p.cpu > 20 ? C.up : C.txtHi2, 'right');
    }
  };

  /* 逐笔成交 / 事件 */
  PT.drawTape = function (ctx, r, S) {
    const t = PT.tickOf(S);
    PT.card(ctx, r.x, r.y, r.w, r.h);
    PT.cardTitle(ctx, r.x + 16, r.y + 20, r.w - 32, '逐笔成交 · 事件');
    const list = (t && t.tape) || [];
    if (!list.length) return;
    const rowH = 16.5;
    const maxRows = Math.max(1, Math.floor((r.h - 46) / rowH));
    const rows = list.slice(0, maxRows);
    const top = r.y + 38;
    const textX = r.x + 72, textMaxW = r.w - 72 - 16;
    for (let i = 0; i < rows.length; i++) {
      const e = rows[i];
      const y = top + i * rowH + rowH / 2;
      PT.text(ctx, e.time || '', r.x + 16, y, '10px ' + F.mono, C.fade);
      // 截断超长文本
      ctx.save();
      ctx.font = '11px ' + F.ui;
      let txt = e.text || '';
      if (ctx.measureText(txt).width > textMaxW) {
        while (txt.length > 1 && ctx.measureText(txt + '…').width > textMaxW) txt = txt.slice(0, -1);
        txt += '…';
      }
      ctx.restore();
      PT.text(ctx, txt, textX, y, '11px ' + F.ui, PT.tapeColor(e.color));
    }
  };

  /* 营收中心 */
  PT.drawEconomy = function (ctx, r, S) {
    const t = PT.tickOf(S);
    PT.card(ctx, r.x, r.y, r.w, r.h);
    PT.cardTitle(ctx, r.x + 16, r.y + 20, r.w - 32, '营收中心', '模拟能耗成本');
    const e = (t && t.econ) || {};
    PT.text(ctx, '¥ ' + PT.fmt(e.total || 0, 2), r.x + 16, r.y + r.h * 0.46, '700 ' + Math.round(r.h * 0.26) + 'px ' + F.num, C.goldSoft);
    PT.text(ctx, '¥' + PT.fmt(e.rate || 0, 2) + ' / 时  ·  峰值 ¥' + PT.fmt(e.peak || 0, 2), r.x + 16, r.y + r.h * 0.70, '11px ' + F.mono, C.dim);
    const parts = e.parts || [];
    let px = r.x + 16, py = r.y + r.h - 22;
    const pw = (r.w - 32) / Math.max(1, parts.length);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const frac = p.full ? PT.clamp((p.net || 0) / p.full, 0, 1) : 0;
      PT.hBar(ctx, px, py, pw - 10, 4, frac, C.blue);
      ctx.font = '9px ' + F.ui; ctx.fillStyle = C.fade; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText((p.name || '').slice(0, 4), px, py + 6);
      px += pw;
    }
  };
})();
