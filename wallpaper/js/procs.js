/* PerfTicker 壁纸 · 进程监控表 */
(function () {
  const PT = window.PT, C = PT.C, F = PT.font;

  PT.drawProcTable = function (ctx, r, S) {
    const t = PT.tickOf(S);
    PT.card(ctx, r.x, r.y, r.w, r.h);
    const procs = (t && t.book) || [];
    PT.cardTitle(ctx, r.x + 16, r.y + 20, r.w - 32, '进程监控', '共 ' + ((t && t.procs) || procs.length) + ' 个');

    const cols = [
      { key: 'name', label: '进程', w: 0.34, align: 'left' },
      { key: 'pid', label: 'PID', w: 0.10, align: 'right' },
      { key: 'cpu', label: 'CPU%', w: 0.12, align: 'right' },
      { key: 'gpu', label: 'GPU%', w: 0.12, align: 'right' },
      { key: 'mem', label: '内存', w: 0.14, align: 'right' },
      { key: 'threads', label: '线程', w: 0.09, align: 'right' },
      { key: 'handles', label: '句柄', w: 0.09, align: 'right' }
    ];
    const padL = 16, padR = 16;
    const innerX = r.x + padL, innerW = r.w - padL - padR;
    const headY = r.y + 44;
    let cx = innerX;
    ctx.textBaseline = 'middle';
    for (const c of cols) {
      ctx.font = '11px ' + F.ui; ctx.fillStyle = C.dim;
      ctx.textAlign = c.align;
      ctx.fillText(c.label, c.align === 'right' ? cx + innerW * c.w : cx, headY);
      cx += innerW * c.w;
    }
    // 分隔线
    ctx.strokeStyle = C.line2; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(innerX, headY + 12); ctx.lineTo(innerX + innerW, headY + 12); ctx.stroke();

    const rowTop = headY + 20;
    const rowH = Math.min(26, (r.h - (rowTop - r.y) - 12) / Math.max(1, Math.min(procs.length, 14)));
    const rows = procs.slice(0, Math.max(1, Math.floor((r.h - (rowTop - r.y) - 10) / rowH)));
    const maxCpu = Math.max(1, ...rows.map(p => p.cpu || 0));
    for (let i = 0; i < rows.length; i++) {
      const p = rows[i];
      const y = rowTop + i * rowH;
      const cy = y + rowH / 2;
      if (i % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.012)'; ctx.fillRect(innerX, y, innerW, rowH); }
      let x = innerX;
      for (const c of cols) {
        const cw = innerW * c.w;
        ctx.font = (c.key === 'name' ? '12px ' + F.ui : '11px ' + F.num);
        let val = '';
        if (c.key === 'name') { val = p.name || ''; ctx.fillStyle = C.txt; }
        else if (c.key === 'mem') { val = (p.mem >= 1024 ? (p.mem / 1024).toFixed(1) + 'G' : Math.round(p.mem || 0) + 'M'); ctx.fillStyle = C.txtHi2; }
        else if (c.key === 'cpu') { val = PT.fmt(p.cpu, 1); ctx.fillStyle = p.cpu > 20 ? C.up : C.txtHi2; }
        else if (c.key === 'gpu') { val = (p.gpu && p.gpu > 0) ? PT.fmt(p.gpu, 1) : '-'; ctx.fillStyle = p.gpu > 12 ? C.purple : C.fade; }
        else if (c.key === 'pid') { val = String(p.pid == null ? '' : p.pid); ctx.fillStyle = C.dim; }
        else if (c.key === 'threads') { val = String(p.threads == null ? '' : p.threads); ctx.fillStyle = C.dim; }
        else { val = String(p.handles == null ? '' : p.handles); ctx.fillStyle = C.dim; }
        ctx.textAlign = c.align;
        ctx.fillText(val, c.align === 'right' ? x + cw : x, cy);
        // CPU 迷你条在名称后
        if (c.key === 'name') {
          const nameW = Math.min(ctx.measureText(val).width, cw - 14);
          PT.hBar(ctx, x + nameW + 10, cy - 2, Math.max(0, cw - nameW - 16), 4, (p.cpu || 0) / maxCpu, p.cpu > 20 ? C.up : C.gold);
        }
        x += cw;
      }
    }
  };
})();
