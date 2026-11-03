/* PerfTicker 壁纸 · 图表绘制（K线 / 均线 / 成交量 / 走势 / 迷你条） */
(function () {
  const PT = window.PT;
  const C = PT.C;

  function movingAvg(candles, n) {
    const out = new Array(candles.length).fill(null);
    let sum = 0;
    for (let i = 0; i < candles.length; i++) {
      sum += candles[i].c;
      if (i >= n) sum -= candles[i - n].c;
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  /* 迷你走势线（指数卡片底部） */
  PT.drawSpark = function (ctx, x, y, w, h, vals, color) {
    if (!vals || vals.length < 2) return;
    let lo = Infinity, hi = -Infinity;
    for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = hi - lo || 1;
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < vals.length; i++) {
      const px = x + (i / (vals.length - 1)) * w;
      const py = y + h - ((vals[i] - lo) / span) * h;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = color; ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round'; ctx.stroke();
    // 底部微光
    ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, color + '33'); g.addColorStop(1, color + '00');
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
  };

  /* 主 K 线图 */
  PT.drawCandles = function (ctx, rect, candles, opts) {
    opts = opts || {};
    const x = rect.x, y = rect.y, w = rect.w, h = rect.h;
    const padL = 12, padR = 64, padT = 10, padB = 58;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    if (plotW <= 10 || plotH <= 10) return;

    ctx.save();
    PT.rr(ctx, x, y, w, h, 8);
    const bg = ctx.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, C.chartBg2); bg.addColorStop(1, C.chartBg);
    ctx.fillStyle = bg; ctx.fill();
    ctx.clip();

    // 网格
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const gy = y + padT + (plotH * i / 4);
      ctx.moveTo(x + padL, gy); ctx.lineTo(x + padL + plotW, gy);
    }
    ctx.stroke();

    if (!candles || candles.length === 0) {
      PT.text(ctx, '等待数据…', x + w / 2, y + h / 2, '14px ' + PT.font.ui, C.dim, 'center');
      ctx.restore(); return;
    }

    // 数值范围
    let lo = Infinity, hi = -Infinity;
    for (const c of candles) { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; }
    const mas = [movingAvg(candles, 5), movingAvg(candles, 10), movingAvg(candles, 20)];
    for (const ma of mas) for (const v of ma) if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = (hi - lo) || 1;
    lo -= span * 0.06; hi += span * 0.06;
    const range = hi - lo;
    const yOf = (v) => y + padT + plotH - ((v - lo) / range) * plotH;

    const n = candles.length;
    const step = plotW / n;
    const bodyW = Math.max(1.5, Math.min(step * 0.62, 14));

    // 成交量区
    let vmax = 0; for (const c of candles) vmax = Math.max(vmax, c.v || 0);
    const volTop = y + padT + plotH + 10;
    const volH = padB - 14;
    if (vmax > 0) {
      for (let i = 0; i < n; i++) {
        const c = candles[i];
        const cx = x + padL + step * (i + 0.5);
        const bh = (c.v / vmax) * volH;
        ctx.fillStyle = (c.c >= c.o ? C.up : C.down) + '66';
        ctx.fillRect(cx - bodyW / 2, volTop + volH - bh, bodyW, bh);
      }
    }

    // K 线
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const cx = x + padL + step * (i + 0.5);
      const up = c.c >= c.o;
      const col = up ? C.up : C.down;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      // 影线
      ctx.beginPath();
      ctx.moveTo(cx, yOf(c.h)); ctx.lineTo(cx, yOf(c.l)); ctx.stroke();
      // 实体
      const yo = yOf(c.o), yc = yOf(c.c);
      const top = Math.min(yo, yc), bh = Math.max(1, Math.abs(yo - yc));
      ctx.fillRect(cx - bodyW / 2, top, bodyW, bh);
    }

    // 均线
    const maColors = [C.gold, C.purple, C.cyan];
    for (let m = 0; m < mas.length; m++) {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < n; i++) {
        const v = mas[m][i]; if (v == null) continue;
        const cx = x + padL + step * (i + 0.5);
        const cy = yOf(v);
        if (!started) { ctx.moveTo(cx, cy); started = true; } else ctx.lineTo(cx, cy);
      }
      ctx.strokeStyle = maColors[m] + 'cc'; ctx.lineWidth = 1.3; ctx.stroke();
    }

    // 右侧价格刻度
    ctx.font = '11px ' + PT.font.mono; ctx.textBaseline = 'middle';
    ctx.fillStyle = C.dim; ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const v = hi - range * i / 4;
      const gy = y + padT + plotH * i / 4;
      ctx.fillText(PT.fmt(v, opts.decimals === undefined ? 2 : opts.decimals), x + padL + plotW + 8, gy);
    }

    // 末价标记
    const last = candles[n - 1];
    const lastCol = last.c >= last.o ? C.up : C.down;
    const ly = yOf(last.c);
    ctx.strokeStyle = lastCol + '80'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + padL, ly); ctx.lineTo(x + padL + plotW, ly); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = lastCol;
    const tagW = 56, tagH = 18;
    const tagX = x + padL + plotW + 6, tagY = ly - tagH / 2;
    PT.rr(ctx, tagX, tagY, tagW, tagH, 3); ctx.fill();
    ctx.fillStyle = '#0a0d13'; ctx.font = '600 11px ' + PT.font.mono; ctx.textAlign = 'center';
    ctx.fillText(PT.fmt(last.c, opts.decimals === undefined ? 2 : opts.decimals), tagX + tagW / 2, ly + 0.5);

    // 均线图例
    ctx.textAlign = 'left'; ctx.font = '11px ' + PT.font.mono;
    const labels = ['MA5', 'MA10', 'MA20'];
    let lx = x + padL + 4;
    for (let m = 0; m < 3; m++) {
      ctx.fillStyle = maColors[m];
      ctx.fillText(labels[m], lx, y + padT + 8);
      lx += 42;
    }
    ctx.restore();
  };

  /* 横向百分比条（进程CPU/内存、营收分项） */
  PT.hBar = function (ctx, x, y, w, h, frac, color, bg) {
    frac = PT.clamp(frac, 0, 1);
    ctx.fillStyle = bg || C.panelSoft;
    PT.rr(ctx, x, y, w, h, h / 2); ctx.fill();
    if (frac > 0) {
      ctx.fillStyle = color;
      PT.rr(ctx, x, y, Math.max(h, w * frac), h, h / 2); ctx.fill();
    }
  };
})();
