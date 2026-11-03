/* PerfTicker 壁纸 · 主题与通用绘制工具
 * 配色/字体对齐原生 GDI+ 界面（Theme.cs 深色主题），确保壁纸与程序观感一致。
 */
(function () {
  const PT = (window.PT = window.PT || {});

  PT.C = {
    bgDeep: '#06080c', bg: '#0a0d13', panel: '#0e121a', panelHi: '#121721',
    panelSoft: '#151b26', rowHover: '#181f2c', rowSel: '#1c2433',
    line: '#181f2b', line2: '#232c3b', grid: '#141a25',
    chartBg: '#070a0f', chartBg2: '#0a0d14',
    textHi: '#e9eff8', txt: '#adb9cb', txtHi2: '#c2ccda',
    dim: '#748193', fade: '#465060', flat: '#9aa6b8',
    up: '#ff4d4f', down: '#00c08b',
    gold: '#f2c14e', goldDim: '#a88636', goldSoft: '#ffd98a',
    blue: '#4d8dff', purple: '#a074ff', cyan: '#3ad6d6', warn: '#ffa940'
  };

  PT.font = {
    num: '"Bahnschrift SemiCondensed","Bahnschrift","Cascadia Mono",Consolas,sans-serif',
    ui: '"Microsoft YaHei UI","Microsoft YaHei",-apple-system,"Segoe UI",sans-serif',
    mono: '"Cascadia Mono",Consolas,"Courier New",monospace'
  };

  PT.tapeColor = function (name) {
    switch (name) {
      case 'up': return PT.C.up; case 'down': return PT.C.down;
      case 'warn': return PT.C.warn; case 'gold': return PT.C.gold;
      case 'blue': return PT.C.blue; case 'cyan': return PT.C.cyan;
      case 'fade': return PT.C.fade; case 'dim': return PT.C.dim;
      default: return PT.C.txt;
    }
  };

  PT.fmt = function (v, d) {
    if (v === null || v === undefined || !isFinite(v)) return '--';
    d = d === undefined ? 2 : d;
    let s = Math.abs(v) >= 1000 ? v.toFixed(d) : v.toFixed(d);
    return s;
  };
  PT.fmtInt = function (v) { return (v === null || v === undefined || !isFinite(v)) ? '--' : Math.round(v).toLocaleString('en-US'); };
  PT.fmtSigned = function (v, d) { if (!isFinite(v)) return '--'; return (v >= 0 ? '+' : '') + v.toFixed(d === undefined ? 2 : d); };
  PT.clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };

  /* 圆角矩形路径（兼容旧 Chromium，不依赖 ctx.roundRect） */
  PT.rr = function (ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  /* 面板卡片：底色 + 细边 + 顶部高光 */
  PT.card = function (ctx, x, y, w, h, opts) {
    opts = opts || {};
    ctx.save();
    PT.rr(ctx, x, y, w, h, opts.r === undefined ? 8 : opts.r);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, opts.top || PT.C.panelHi);
    g.addColorStop(1, opts.bottom || PT.C.panel);
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = opts.border || PT.C.line;
    ctx.stroke();
    ctx.restore();
  };

  /* 卡片标题行 */
  PT.cardTitle = function (ctx, x, y, w, text, right) {
    ctx.save();
    ctx.font = '600 13px ' + PT.font.ui;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = PT.C.gold;
    ctx.fillText(text, x, y);
    if (right) {
      ctx.font = '12px ' + PT.font.mono;
      ctx.fillStyle = PT.C.dim;
      ctx.textAlign = 'right';
      ctx.fillText(right, x + w, y);
    }
    ctx.restore();
  };

  PT.text = function (ctx, s, x, y, font, color, align) {
    ctx.save();
    ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'middle';
    ctx.textAlign = align || 'left';
    ctx.fillText(s, x, y);
    ctx.restore();
  };
})();
