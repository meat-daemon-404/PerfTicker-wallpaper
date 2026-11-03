/* PerfTicker 壁纸 · 主程序
 * - 自动发现本地数据桥（127.0.0.1:51789 起顺延 20 个端口）
 * - 连接失败时进入「离线演示」合成数据，保证壁纸永不空白
 * - Canvas 全屏自绘，随分辨率自适应
 */
(function () {
  const PT = window.PT, C = PT.C, F = PT.font;

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const S = {
    hello: null, tick: null, connected: false,
    sel: '000002', period: 5000,
    hist: [], clock: Date.now(), demo: null,
    base: null, failCount: 0, lastHistAt: 0, ws: null
  };

  /* ── 数据桥客户端 ─────────────────────────────── */
  const PORTS = [];
  for (let p = 51789; p <= 51808; p++) PORTS.push(p);

  function withTimeout(url, ms) {
    const ctl = new AbortController();
    const id = setTimeout(() => ctl.abort(), ms || 1200);
    return fetch(url, { cache: 'no-store', signal: ctl.signal })
      .finally(() => clearTimeout(id));
  }

  async function discover() {
    for (const p of PORTS) {
      const base = 'http://127.0.0.1:' + p;
      try {
        const r = await withTimeout(base + '/api/hello', 450);
        if (!r.ok) continue;
        const hello = await r.json();
        S.base = base; S.hello = hello; S.connected = true; S.failCount = 0;
        if (hello.selected) S.sel = hello.selected;
        if (hello.periodMs) S.period = hello.periodMs;
        connectWS(base);
        return;
      } catch (e) { /* 该端口无桥，试下一个 */ }
    }
    S.connected = false;
  }

  async function pollTick() {
    if (S.ws && S.ws.readyState === 1) return; // WebSocket 推送中，无需轮询
    if (!S.base) { await discover(); }
    if (!S.base) { S.connected = false; return; }
    try {
      const r = await withTimeout(S.base + '/api/tick', 1500);
      if (!r.ok) throw new Error('bad ' + r.status);
      S.tick = await r.json();
      S.connected = true; S.failCount = 0; S.clock = Date.now();
      if (Date.now() - S.lastHistAt > 4000) { S.lastHistAt = Date.now(); pollHistory(); }
    } catch (e) {
      S.failCount++;
      if (S.failCount >= 2) { S.connected = false; S.base = null; }
    }
  }

  async function pollHistory() {
    if (!S.base) return;
    try {
      const r = await withTimeout(S.base + '/api/history?code=' + encodeURIComponent(S.sel) + '&period=' + S.period, 2000);
      if (!r.ok) return;
      const h = await r.json();
      S.hist = h.candles || [];
    } catch (e) { }
  }

  /* WebSocket 推送（优先通道）：连上后服务端每 1s 推 tick；断开自动重连并回退 HTTP 轮询 */
  function connectWS(base) {
    try {
      if (S.ws && (S.ws.readyState === 0 || S.ws.readyState === 1)) return;
      const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
      S.ws = ws;
      ws.onopen = () => {
        S.connected = true; S.failCount = 0;
        document.documentElement.setAttribute('data-ws', '1');
      };
      ws.onmessage = (ev) => {
        let obj; try { obj = JSON.parse(ev.data); } catch (e) { return; }
        if (obj && obj.app) {
          S.hello = obj;
          if (obj.selected) S.sel = obj.selected;
          if (obj.periodMs) S.period = obj.periodMs;
          return;
        }
        if (obj && obj.t !== undefined) {
          S.tick = obj; S.connected = true; S.failCount = 0; S.clock = Date.now();
          if (Date.now() - S.lastHistAt > 4000) { S.lastHistAt = Date.now(); pollHistory(); }
        }
      };
      ws.onclose = () => {
        if (S.ws === ws) S.ws = null;
        document.documentElement.setAttribute('data-ws', '0');
        if (S.base) setTimeout(() => { if (!S.ws && S.base) connectWS(S.base); }, 3000);
      };
      ws.onerror = () => { try { ws.close(); } catch (e) { } };
    } catch (e) { S.ws = null; }
  }

  /* ── 离线演示数据 ─────────────────────────────── */
  const DEMO_DEFS = [
    { code: '000001', name: 'CPU 综合指数', unit: 'GHz', decimals: 2, base: 3.62, vol: 0.18 },
    { code: '000002', name: 'CPU 负载', unit: '%', decimals: 1, base: 16, vol: 7 },
    { code: '000003', name: '内存占用', unit: '%', decimals: 1, base: 51, vol: 1.2 }
  ];
  const PROC_NAMES = ['chrome.exe', 'Code.exe', 'dwm.exe', 'explorer.exe', 'msedge.exe', 'WeChat.exe',
    'cs2.exe', 'Discord.exe', 'svchost.exe', 'System', 'QQ.exe', 'Steam.exe', 'python.exe',
    'SearchIndexer.exe', 'RuntimeBroker.exe', 'Taskmgr.exe', 'conhost.exe', 'lsass.exe',
    'OneDrive.exe', 'CloudMusic.exe', 'nvcontainer.exe', 'audiodg.exe', 'Spoolsv.exe', 'fontdrvhost.exe'];
  const TAPE_TEXTS = [
    ['核心 08 频率拉升 +120MHz', 'up'], ['内存占用突破 55%', 'warn'], ['GPU 温度 61°C', 'gold'],
    ['磁盘写入 96 MB/s', 'cyan'], ['网络下行 12.4 MB/s', 'blue'], ['上下文切换回落', 'dim'],
    ['CPU 负载走低 -4.2%', 'down'], ['进程 chrome.exe 占用上升', 'warn'], ['营收速率 ¥0.42/时', 'gold']
  ];

  const Demo = {
    procs: [], tape: [],
    init() {
      const t = { t: 0, wall: 0, cpuName: 'Demo CPU', intervalMs: 1000, periodMs: 5000, redUp: true };
      t.metrics = DEMO_DEFS.map(d => {
        const spark = [];
        for (let i = 0; i < 60; i++) spark.push(d.base * (1 + (Math.random() - 0.5) * d.vol * 0.1));
        return { code: d.code, name: d.name, unit: d.unit, decimals: d.decimals,
          value: d.base, prev: d.base, open: d.base, chg: 0, chgPct: 0, chgText: '+0.00', spark,
          highPct: 0, lowPct: 0 };
      });
      t.coresPct = Array.from({ length: 24 }, () => 6 + Math.random() * 12);
      t.coresMHz = t.coresPct.map(v => 1800 + v * 40);
      t.gpu = { ok: true, name: 'Demo GPU', nvml: true, util: 8, memUtil: 2, clock: 300, temp: 46, power: 15 };
      t.mem = { used: 16, total: 32, pct: 51, pageUsed: 21, pageTotal: 57 };
      this.procs = PROC_NAMES.map((n, i) => ({
        pid: 1000 + i * 37, name: n, cpu: Math.random() * 8, gpu: Math.random() * 3,
        mem: 40 + Math.random() * 900, threads: 4 + ((Math.random() * 40) | 0),
        handles: 100 + ((Math.random() * 2000) | 0), cpuNorm: 0, delta: 0
      }));
      t.procs = 180;
      t.econ = { on: true, total: 0.37, rate: 0.42, peak: 0.61, parts: [
        { name: 'CPU综合', load: 18, net: 3.1, total: 0.12, full: 22 },
        { name: 'GPU引擎', load: 6, net: 1.2, total: 0.09, full: 30 },
        { name: '内存', load: 51, net: 2.4, total: 0.05, full: 12 },
        { name: '磁盘IO', load: 3, net: 0.8, total: 0.04, full: 7.2 },
        { name: '网络', load: 2, net: 0.6, total: 0.07, full: 7.2 }
      ] };
      this.tick = t;
      S.demo = t;
    },
    step() {
      const t = this.tick; t.t++; t.wall += 1;
      // 指标随机游走
      for (const d of DEMO_DEFS) {
        const m = t.metrics.find(x => x.code === d.code);
        const drift = (Math.random() - 0.5) * d.vol;
        m.value = Math.max(0, m.value + drift);
        m.chg = m.value - m.open;
        m.chgPct = m.open ? m.chg / m.open * 100 : 0;
        m.chgText = (m.chg >= 0 ? '+' : '') + m.chg.toFixed(d.decimals) + '  ' + (m.chgPct >= 0 ? '+' : '') + m.chgPct.toFixed(2) + '%';
        m.highPct = Math.max(m.highPct || 0, m.chgPct);
        m.lowPct = Math.min(m.lowPct || 0, m.chgPct);
        m.spark.push(m.value); if (m.spark.length > 60) m.spark.shift();
      }
      // 核心
      t.coresPct = t.coresPct.map(v => PT.clamp(v + (Math.random() - 0.5) * 14, 2, 98));
      t.coresMHz = t.coresPct.map(v => 1200 + v * 42);
      t.cpu = t.coresPct.reduce((a, b) => a + b, 0) / t.coresPct.length;
      t.gpu.util = PT.clamp(t.gpu.util + (Math.random() - 0.5) * 6, 0, 100);
      t.mem.pct = PT.clamp(t.mem.pct + (Math.random() - 0.5) * 0.6, 30, 90);
      t.mem.used = t.mem.total * t.mem.pct / 100;
      // 进程
      for (const p of this.procs) { p.cpu = PT.clamp(p.cpu + (Math.random() - 0.5) * p.cpu * 0.5 + Math.random() * 0.4, 0, 100); p.gpu = PT.clamp(p.gpu + (Math.random() - 0.5) * 1.5, 0, 100); }
      t.book = this.procs.slice().sort((a, b) => b.cpu - a.cpu).slice(0, 30);
      // 事件
      if (Math.random() < 0.6) {
        const e = TAPE_TEXTS[(Math.random() * TAPE_TEXTS.length) | 0];
        const d = new Date();
        this.tape.unshift({ time: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0'), text: e[0], color: e[1] });
        if (this.tape.length > 30) this.tape.pop();
      }
      t.tape = this.tape;
      // 营收累加
      const dt = 1;
      let sum = 0;
      for (const p of t.econ.parts) { p.load = PT.clamp(p.load + (Math.random() - 0.5) * 4, 0, 100); p.net = p.full * Math.pow(p.load / 100, 1.7) * 0.9; sum += p.net; }
      t.econ.total = (t.econ.total || 0) + sum * dt / 3600;
      t.econ.rate = sum;
      t.econ.peak = Math.max(t.econ.peak || 0, t.econ.rate);
      // selected 映射
      const sel = t.metrics.find(x => x.code === S.sel) || t.metrics[1];
      t.selected = Object.assign({}, sel);
    },
    history() {
      const m = (this.tick.metrics.find(x => x.code === S.sel) || this.tick.metrics[1]);
      const n = 60, base = m.value, out = [];
      let price = base * 0.995, bucket = Date.now() - n * 2000;
      for (let i = 0; i < n; i++) {
        const o = price;
        price = Math.max(0.01, price + (Math.random() - 0.5) * base * 0.012);
        const c = price;
        const h = Math.max(o, c) * (1 + Math.random() * 0.004);
        const l = Math.min(o, c) * (1 - Math.random() * 0.004);
        out.push({ t: bucket + i * 2000, o, h, l, c, v: 20000 + Math.random() * 90000 });
      }
      return out;
    }
  };

  /* ── 布局与渲染 ───────────────────────────────── */
  let cssW = 0, cssH = 0, dpr = 1;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    cssW = window.innerWidth || document.documentElement.clientWidth;
    cssH = window.innerHeight || document.documentElement.clientHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
  }

  function drawBg() {
    const g = ctx.createLinearGradient(0, 0, cssW * 0.4, cssH);
    g.addColorStop(0, '#070a10'); g.addColorStop(0.55, C.bg); g.addColorStop(1, '#05070b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cssW, cssH);
    // 极淡径向光
    const rad = ctx.createRadialGradient(cssW * 0.5, -cssH * 0.1, 0, cssW * 0.5, -cssH * 0.1, cssH * 1.1);
    rad.addColorStop(0, 'rgba(77,141,255,0.05)');
    rad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  function render() {
    const W = cssW, H = cssH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBg();

    const pad = PT.clamp(W * 0.012, 10, 26);
    const gap = PT.clamp(W * 0.007, 7, 16);
    const innerW = W - pad * 2;
    const titleH = PT.clamp(H * 0.062, 44, 62);
    const stripH = PT.clamp(H * 0.115, 74, 108);
    const titleY = pad * 0.7;
    const stripY = titleY + titleH + gap;
    const bodyY = stripY + stripH + gap;
    const bodyH = H - bodyY - pad;

    PT.drawTitleBar(ctx, { x: pad, y: titleY, w: innerW, h: titleH }, S);
    PT.drawIndexCards(ctx, { x: pad, y: stripY, w: innerW, h: stripH }, S, ['000001', '000002', '000003']);

    // 分栏
    const rightW = PT.clamp(W * 0.265, 300, 540);
    const leftW = innerW - rightW - gap;
    const chartH = Math.round((bodyH - gap) * 0.605);
    const procH = bodyH - chartH - gap;

    // 左：K线卡 + 进程表
    PT.card(ctx, pad, bodyY, leftW, chartH);
    const t = PT.tickOf(S);
    const selm = (t && t.selected) || {};
    PT.cardTitle(ctx, pad + 16, bodyY + 22, leftW - 32, (selm.name || '行情') + '  ·  K 线', (S.period / 1000) + 's');
    // 标题右侧行情摘要
    const dec = selm.decimals === undefined ? 2 : selm.decimals;
    const chg = selm.chg || 0;
    const col = chg > 0.0001 ? C.up : chg < -0.0001 ? C.down : C.flat;
    PT.text(ctx, PT.fmt(selm.value, dec), pad + leftW - 96, bodyY + 22, '600 15px ' + F.num, C.textHi, 'right');
    PT.text(ctx, selm.chgText || '', pad + leftW - 16, bodyY + 22, '600 12px ' + F.num, col, 'right');

    let candles = S.connected ? S.hist : null;
    if (!candles || candles.length === 0) candles = S.connected ? null : Demo.history();
    if (S.connected && (!candles || !candles.length)) {
      // 用 tick 里的 spark 兜底成走势
      const sp = selm.spark || [];
      candles = sp.map((v, i) => ({ t: i, o: v, h: v, l: v, c: v, v: 0 }));
    }
    PT.drawCandles(ctx, { x: pad, y: bodyY + 34, w: leftW, h: chartH - 42 }, candles, { decimals: dec });

    PT.drawProcTable(ctx, { x: pad, y: bodyY + chartH + gap, w: leftW, h: procH }, S);

    // 右列
    const rx = pad + leftW + gap;
    const instH = PT.clamp(bodyH * 0.19, 120, 176);
    const coresH = PT.clamp(bodyH * 0.19, 110, 170);
    const tapeH = PT.clamp(bodyH * 0.155, 110, 168);
    const econH = PT.clamp(bodyH * 0.135, 96, 150);
    const bookH = bodyH - instH - coresH - tapeH - econH - gap * 4;
    let y = bodyY;
    PT.drawInstrument(ctx, { x: rx, y: y, w: rightW, h: instH }, S); y += instH + gap;
    PT.drawCores(ctx, { x: rx, y: y, w: rightW, h: coresH }, S); y += coresH + gap;
    PT.drawBook(ctx, { x: rx, y: y, w: rightW, h: Math.max(90, bookH) }, S); y += Math.max(90, bookH) + gap;
    PT.drawTape(ctx, { x: rx, y: y, w: rightW, h: tapeH }, S); y += tapeH + gap;
    PT.drawEconomy(ctx, { x: rx, y: y, w: rightW, h: econH }, S);

    // 离线水印
    if (!S.connected) {
      ctx.save();
      ctx.font = '11px ' + F.ui; ctx.fillStyle = 'rgba(255,169,64,0.55)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('离线演示数据 · 启动 PerfTicker 数据桥后自动接入实时行情', W / 2, H - 6);
      ctx.restore();
    }
  }

  function loop() {
    S.clock = Date.now();
    render();
    requestAnimationFrame(loop);
  }

  /* ── 启动 ─────────────────────────────────────── */
  function boot() {
    document.documentElement.setAttribute('data-ws', '0');
    resize();
    window.addEventListener('resize', () => { resize(); });
    Demo.init();
    // 首次连接（失败则保持演示）
    discover().then(() => {
      if (S.connected) pollTick();
    });
    // 定时抓取实时数据；未连接则推进演示数据
    setInterval(() => {
      if (S.connected) {
        pollTick();
      } else {
        Demo.step();
        S.demo = Demo.tick;
        // 每 10 秒再尝试重连
        if ((Date.now() / 1000 | 0) % 10 === 0) discover();
      }
    }, 1000);
    render();               // 立即绘制首帧，保证 headless / 隐藏页也有画面
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') boot();
  else window.addEventListener('DOMContentLoaded', boot);
})();
