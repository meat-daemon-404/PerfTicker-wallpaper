/* PerfTicker - Theme & Shared Utilities
 * Visual themes, layout modes, position presets, alert flash,
 * and shared formatting helpers (PT.fmt).
 * Exposed on window.PT.
 */
(function (root) {
  'use strict';

  var PT = root.PT = root.PT || {};

  var THEMES = ['cyber', 'minimal', 'retro', ' Eva', ' clean'].map(function (s) { return s.trim().toLowerCase(); });
  // Canonical list:
  THEMES = ['cyber', 'minimal', 'retro', 'eva', 'clean'];

  var LAYOUTS = ['full', 'compact', 'mini'];
  var POSITIONS = ['tl', 'tr', 'bl', 'br', 'center'];

  var state = {
    theme: 'cyber',
    layout: 'full',
    position: 'tr',
    scale: 1.0,
    opacity: 0.92,
    blur: true,
    showSparkline: true,
    showProcesses: true,
    showDisk: true,
    showTemps: true,
    fpsTarget: 30,
    alertCpuTemp: 85,
    alertGpuTemp: 85,
    alertCpuLoad: 95,
    alertRamLoad: 92,
    accentColor: null // null = theme default
  };

  /* -------------------- Shared Formatters -------------------- */
  var fmt = PT.fmt = PT.fmt || {
    num: function (v, digits) {
      if (v === null || v === undefined || isNaN(v)) return '--';
      return Number(v).toFixed(digits || 0);
    },
    pct: function (v) {
      if (v === null || v === undefined || isNaN(v)) return '--%';
      return Math.round(Number(v)) + '%';
    },
    temp: function (v) {
      if (v === null || v === undefined || isNaN(v) || v <= 0) return '--°C';
      return Math.round(Number(v)) + '°C';
    },
    bytesRate: function (bps) {
      if (bps === null || bps === undefined || isNaN(bps) || bps < 0) return '0 B/s';
      var units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
      var u = 0;
      var val = Number(bps);
      while (val >= 1024 && u < units.length - 1) {
        val /= 1024;
        u++;
      }
      return val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2) + ' ' + units[u];
    },
    gb: function (mb) {
      if (mb === null || mb === undefined || isNaN(mb)) return '-- GB';
      return (Number(mb) / 1024).toFixed(1) + ' GB';
    }
  };

  /* -------------------- DOM Application -------------------- */
  function applyAll() {
    var body = document.body;
    if (!body) return;

    THEMES.forEach(function (t) { body.classList.remove('theme-' + t); });
    body.classList.add('theme-' + state.theme);

    LAYOUTS.forEach(function (l) { body.classList.remove('layout-' + l); });
    body.classList.add('layout-' + state.layout);

    POSITIONS.forEach(function (p) { body.classList.remove('pos-' + p); });
    body.classList.add('pos-' + state.position);

    body.classList.toggle('no-blur', !state.blur);
    body.classList.toggle('hide-spark', !state.showSparkline);
    body.classList.toggle('hide-procs', !state.showProcesses);
    body.classList.toggle('hide-disk', !state.showDisk);
    body.classList.toggle('hide-temps', !state.showTemps);

    var rootEl = document.documentElement;
    rootEl.style.setProperty('--pt-scale', String(state.scale));
    rootEl.style.setProperty('--pt-opacity', String(state.opacity));
    if (state.accentColor) {
      rootEl.style.setProperty('--pt-accent-override', state.accentColor);
      body.classList.add('has-accent-override');
    } else {
      rootEl.style.removeProperty('--pt-accent-override');
      body.classList.remove('has-accent-override');
    }
  }

  function configure(patch) {
    if (!patch || typeof patch !== 'object') return;
    if (patch.theme && THEMES.indexOf(patch.theme) !== -1) state.theme = patch.theme;
    if (patch.layout && LAYOUTS.indexOf(patch.layout) !== -1) state.layout = patch.layout;
    if (patch.position && POSITIONS.indexOf(patch.position) !== -1) state.position = patch.position;
    if (typeof patch.scale === 'number') state.scale = Math.max(0.5, Math.min(2.0, patch.scale));
    if (typeof patch.opacity === 'number') state.opacity = Math.max(0.2, Math.min(1.0, patch.opacity));
    if (typeof patch.blur === 'boolean') state.blur = patch.blur;
    if (typeof patch.showSparkline === 'boolean') state.showSparkline = patch.showSparkline;
    if (typeof patch.showProcesses === 'boolean') state.showProcesses = patch.showProcesses;
    if (typeof patch.showDisk === 'boolean') state.showDisk = patch.showDisk;
    if (typeof patch.showTemps === 'boolean') state.showTemps = patch.showTemps;
    if (typeof patch.fpsTarget === 'number') state.fpsTarget = Math.max(1, Math.min(120, patch.fpsTarget));
    if (typeof patch.alertCpuTemp === 'number') state.alertCpuTemp = patch.alertCpuTemp;
    if (typeof patch.alertGpuTemp === 'number') state.alertGpuTemp = patch.alertGpuTemp;
    if (typeof patch.alertCpuLoad === 'number') state.alertCpuLoad = patch.alertCpuLoad;
    if (typeof patch.alertRamLoad === 'number') state.alertRamLoad = patch.alertRamLoad;
    if (patch.accentColor !== undefined) state.accentColor = patch.accentColor;

    applyAll();
  }

  /* -------------------- Alert Evaluation -------------------- */
  function evaluateAlerts(sample) {
    if (!sample) return { any: false, reasons: [] };
    var reasons = [];
    if (sample.cpu && sample.cpu.temp >= state.alertCpuTemp) {
      reasons.push('CPU ' + Math.round(sample.cpu.temp) + '°C');
    }
    if (sample.gpu && sample.gpu.temp >= state.alertGpuTemp) {
      reasons.push('GPU ' + Math.round(sample.gpu.temp) + '°C');
    }
    if (sample.cpu && sample.cpu.load >= state.alertCpuLoad) {
      reasons.push('CPU ' + Math.round(sample.cpu.load) + '%');
    }
    if (sample.ram && sample.ram.load >= state.alertRamLoad) {
      reasons.push('RAM ' + Math.round(sample.ram.load) + '%');
    }
    var any = reasons.length > 0;
    if (document.body) {
      document.body.classList.toggle('alert-active', any);
    }
    return { any: any, reasons: reasons };
  }

  /* -------------------- Wallpaper Engine Property Mapping -------------------- */
  function applyWEProperties(props) {
    if (!props) return;
    var patch = {};
    if (props.theme && props.theme.value !== undefined) patch.theme = String(props.theme.value);
    if (props.layout && props.layout.value !== undefined) patch.layout = String(props.layout.value);
    if (props.position && props.position.value !== undefined) patch.position = String(props.position.value);
    if (props.scale && props.scale.value !== undefined) patch.scale = Number(props.scale.value) / 100;
    if (props.opacity && props.opacity.value !== undefined) patch.opacity = Number(props.opacity.value) / 100;
    if (props.blur && props.blur.value !== undefined) patch.blur = Boolean(props.blur.value);
    if (props.showsparkline && props.showsparkline.value !== undefined) patch.showSparkline = Boolean(props.showsparkline.value);
    if (props.showprocesses && props.showprocesses.value !== undefined) patch.showProcesses = Boolean(props.showprocesses.value);
    if (props.showdisk && props.showdisk.value !== undefined) patch.showDisk = Boolean(props.showdisk.value);
    if (props.showtemps && props.showtemps.value !== undefined) patch.showTemps = Boolean(props.showtemps.value);
    if (props.fpstarget && props.fpstarget.value !== undefined) patch.fpsTarget = Number(props.fpstarget.value);
    if (props.alertcputemp && props.alertcputemp.value !== undefined) patch.alertCpuTemp = Number(props.alertcputemp.value);
    if (props.alertgputemp && props.alertgputemp.value !== undefined) patch.alertGpuTemp = Number(props.alertgputemp.value);
    if (props.accentcolor && props.accentcolor.value) {
      // WE color format: "r g b" normalized 0..1
      var parts = String(props.accentcolor.value).split(' ').map(Number);
      if (parts.length >= 3 && !isNaN(parts[0])) {
        var r = Math.round(parts[0] * 255);
        var g = Math.round(parts[1] * 255);
        var b = Math.round(parts[2] * 255);
        patch.accentColor = 'rgb(' + r + ',' + g + ',' + b + ')';
      }
    }
    configure(patch);
  }

  PT.theme = {
    state: state,
    THEMES: THEMES,
    LAYOUTS: LAYOUTS,
    POSITIONS: POSITIONS,
    configure: configure,
    applyAll: applyAll,
    evaluateAlerts: evaluateAlerts,
    applyWEProperties: applyWEProperties,
    fmt: fmt
  };
})(window);
