using System.Drawing;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PerfTicker;

/// <summary>
/// 壁纸数据桥：在本机回环地址上开一个极简 HTTP/1.1 服务，把采样数据以 JSON 提供给
/// Wallpaper Engine 的 Web 壁纸（CEF）读取。
///
/// 设计要点（相对原方案的修正，见 docs/wallpaper-architecture-review.md）：
///  - 不用 HttpListener：它需要 URL ACL / 管理员权限，普通用户会直接 Exception。
///    改用 TcpListener 自实现最小 HTTP，绑定 127.0.0.1，无需任何系统配置。
///  - 双通道：HTTP 轮询（/api/tick 等，兼容一切环境）+ WebSocket 推送（/ws，手写 RFC6455 帧，
///    首次连上先发 hello 再按 interval 推 tick，前端优先用 WS、失败自动退回轮询）。
///  - 端口自适应：从 51789 起顺延，占用则 +1，最终端口写入
///    %LOCALAPPDATA%\PerfTicker\bridge.json，前端先连默认口，失败再读配置。
///  - 只读为主：不暴露结束进程等破坏性命令；POST 命令要求 X-Requested-With 头，挡跨站表单。
/// </summary>
internal sealed class BridgeServer : IDisposable
{
    public const int DefaultPort = 51789;
    private const int MaxPortTries = 20;
    private const string Json = "application/json";

    private readonly Func<string> _hello;
    private readonly Func<string> _tick;
    private readonly Func<string, long, string> _history;
    private readonly Func<string, int, string> _spark;
    private readonly Action<string, string> _command;

    private TcpListener _listener;
    private Thread _accept;
    private volatile bool _stop;
    private int _port;

    public int Port => _port;
    public string Url => _port > 0 ? $"http://127.0.0.1:{_port}/" : "";

    private BridgeServer(Func<string> hello, Func<string> tick,
        Func<string, long, string> history, Func<string, int, string> spark,
        Action<string, string> command)
    {
        _hello = hello; _tick = tick; _history = history; _spark = spark; _command = command;
    }

    /// <summary>GUI 模式：所有读取都切回 UI 线程，避免与采样/重绘竞态；命令也回投 UI 线程。</summary>
    public static BridgeServer ForForm(AppForm form)
    {
        T Invoke<T>(Func<T> f)
        {
            try
            {
                if (form.IsHandleCreated && form.InvokeRequired) return (T)form.Invoke(f);
                return f();
            }
            catch { return default; }
        }
        return new BridgeServer(
            () => Invoke(() => BridgeJson.Hello(form.St, form.Hw)) ?? "{}",
            () => Invoke(() => BridgeJson.Tick(form.St, form.Hw)) ?? "{}",
            (code, period) => Invoke(() => BridgeJson.History(form.St, code, period)) ?? "{}",
            (code, n) => Invoke(() => BridgeJson.Spark(form.St, code, n)) ?? "{}",
            (cmd, arg) => Invoke<object>(() => { form.ApplyBridgeCommand(cmd, arg); return null; }));
    }

    /// <summary>无头模式：传感器核心自己带锁。</summary>
    public static BridgeServer ForSensor(SensorCore core)
    {
        return new BridgeServer(
            () => { lock (core.Sync) return BridgeJson.Hello(core.St, core.Hw); },
            () => { lock (core.Sync) return BridgeJson.Tick(core.St, core.Hw); },
            (code, period) => { lock (core.Sync) return BridgeJson.History(core.St, code, period); },
            (code, n) => { lock (core.Sync) return BridgeJson.Spark(core.St, code, n); },
            (cmd, arg) => core.ApplyCommand(cmd, arg));
    }

    public void Start(int preferredPort = DefaultPort)
    {
        Exception last = null;
        for (int i = 0; i < MaxPortTries; i++)
        {
            int port = preferredPort + i;
            try
            {
                var l = new TcpListener(IPAddress.Loopback, port);
                l.Start();
                _listener = l;
                _port = port;
                _accept = new Thread(AcceptLoop) { IsBackground = true, Name = "PerfTicker.Bridge" };
                _accept.Start();
                WriteInfo();
                Diag.Write("BRIDGE", $"listening {Url}");
                return;
            }
            catch (Exception ex) { last = ex; }
        }
        throw new IOException("桥接端口全部被占用: " + last?.Message);
    }

    private void WriteInfo()
    {
        try
        {
            string dir = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PerfTicker");
            System.IO.Directory.CreateDirectory(dir);
            string json = "{\"url\":\"" + Url + "\",\"port\":" + _port +
                          ",\"protocol\":1,\"pid\":" + Environment.ProcessId + "}";
            System.IO.File.WriteAllText(System.IO.Path.Combine(dir, "bridge.json"), json, new UTF8Encoding(false));
        }
        catch { }
    }

    private void AcceptLoop()
    {
        while (!_stop)
        {
            TcpClient client;
            try { client = _listener.AcceptTcpClient(); }
            catch { if (_stop) return; continue; }
            ThreadPool.QueueUserWorkItem(_ => Handle(client));
        }
    }

    private void Handle(TcpClient client)
    {
        try
        {
            client.ReceiveTimeout = 5000;
            client.SendTimeout = 5000;
            using var stream = client.GetStream();
            string requestLine = ReadRequest(stream, out string headers, out byte[] body);
            if (requestLine == null) return;
            var parts = requestLine.Split(' ');
            if (parts.Length < 2) { Write(stream, 400, "text/plain", "bad request"); return; }
            string method = parts[0].ToUpperInvariant();
            string target = parts[1];
            string path = target, query = "";
            int q = target.IndexOf('?');
            if (q >= 0) { path = target[..q]; query = target[(q + 1)..]; }
            var qs = ParseQuery(query);

            // WebSocket 升级（推送通道）：/ws
            if (path == "/ws" && headers.IndexOf("upgrade: websocket", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                HandleWebSocket(client, stream, headers);
                return;
            }

            if (method == "OPTIONS") { Write(stream, 204, "text/plain", ""); return; }

            if (path == "/api/hello" && method == "GET") { Write(stream, 200, Json, _hello()); return; }
            if (path == "/api/tick" && method == "GET") { Write(stream, 200, Json, _tick()); return; }
            if (path == "/api/history" && method == "GET")
            {
                qs.TryGetValue("code", out var code);
                qs.TryGetValue("period", out var ps);
                long period = long.TryParse(ps, out var pv) ? pv : 5000;
                Write(stream, 200, Json, _history(code ?? "", period));
                return;
            }
            if (path == "/api/spark" && method == "GET")
            {
                qs.TryGetValue("code", out var code);
                qs.TryGetValue("n", out var ns);
                int n = int.TryParse(ns, out var nv) ? nv : 40;
                Write(stream, 200, Json, _spark(code ?? "", n));
                return;
            }
            if (path == "/api/cmd" && method == "POST")
            {
                if (!headers.ToLowerInvariant().Contains("x-requested-with: perfticker"))
                {
                    Write(stream, 403, Json, "{\"ok\":false,\"error\":\"missing X-Requested-With header\"}");
                    return;
                }
                string cmd = "", arg = "";
                try
                {
                    using var doc = JsonDocument.Parse(body ?? Array.Empty<byte>());
                    if (doc.RootElement.TryGetProperty("cmd", out var c)) cmd = c.GetString() ?? "";
                    if (doc.RootElement.TryGetProperty("arg", out var a)) arg = a.GetString() ?? "";
                }
                catch { }
                if (cmd.Length > 0) { try { _command(cmd, arg); } catch { } }
                Write(stream, 200, Json, "{\"ok\":true}");
                return;
            }
            if (path == "/" || path == "/ping")
            {
                Write(stream, 200, "text/plain", "PerfTicker bridge\n" + Url);
                return;
            }
            Write(stream, 404, "text/plain", "not found");
        }
        catch { }
        finally { try { client.Close(); } catch { } }
    }

    private static string ReadRequest(NetworkStream s, out string headers, out byte[] body)
    {
        headers = ""; body = Array.Empty<byte>();
        var buf = new List<byte>(1024);
        var one = new byte[1];
        while (true)
        {
            int n;
            try { n = s.Read(one, 0, 1); } catch { return null; }
            if (n <= 0) return null;
            buf.Add(one[0]);
            int c = buf.Count;
            if (c >= 4 && buf[c - 4] == 13 && buf[c - 3] == 10 && buf[c - 2] == 13 && buf[c - 1] == 10) break;
            if (c > 64 * 1024) return null;
        }
        string all = Encoding.ASCII.GetString(buf.ToArray());
        int idx = all.IndexOf("\r\n", StringComparison.Ordinal);
        if (idx < 0) return null;
        string line = all[..idx];
        headers = all[(idx + 2)..];
        int cl = 0;
        foreach (var hl in headers.Split("\r\n"))
            if (hl.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
                int.TryParse(hl[15..].Trim(), out cl);
        if (cl > 0 && cl < 1_000_000)
        {
            body = new byte[cl];
            int read = 0;
            while (read < cl)
            {
                int n;
                try { n = s.Read(body, read, cl - read); } catch { break; }
                if (n <= 0) break;
                read += n;
            }
        }
        return line;
    }

    private static void Write(NetworkStream s, int code, string ctype, string body)
    {
        byte[] b = Encoding.UTF8.GetBytes(body ?? "");
        string status = code switch
        {
            200 => "OK", 204 => "No Content", 400 => "Bad Request",
            403 => "Forbidden", 404 => "Not Found", _ => "OK"
        };
        string head =
            $"HTTP/1.1 {code} {status}\r\n" +
            $"Content-Type: {ctype}; charset=utf-8\r\n" +
            $"Content-Length: {b.Length}\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
            "Access-Control-Allow-Headers: Content-Type, X-Requested-With\r\n" +
            "Cache-Control: no-store\r\n" +
            "Connection: close\r\n\r\n";
        try
        {
            var hb = Encoding.ASCII.GetBytes(head);
            s.Write(hb, 0, hb.Length);
            if (b.Length > 0) s.Write(b, 0, b.Length);
            s.Flush();
        }
        catch { }
    }

    private static Dictionary<string, string> ParseQuery(string q)
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrEmpty(q)) return d;
        foreach (var kv in q.Split('&'))
        {
            if (kv.Length == 0) continue;
            int e = kv.IndexOf('=');
            string k = e < 0 ? kv : kv[..e];
            string v = e < 0 ? "" : kv[(e + 1)..];
            try { d[Uri.UnescapeDataString(k)] = Uri.UnescapeDataString(v); } catch { }
        }
        return d;
    }

    /// <summary>WebSocket 推送：完成 RFC6455 握手后，先发一帧 hello，再每 1s 推一帧 tick。
    /// 前端优先用它（延迟更低、无需轮询）；失败会自动退回 HTTP 轮询。</summary>
    private void HandleWebSocket(TcpClient client, NetworkStream stream, string headers)
    {
        string key = GetHeader(headers, "Sec-WebSocket-Key");
        if (string.IsNullOrEmpty(key)) { Write(stream, 400, "text/plain", "missing Sec-WebSocket-Key"); return; }

        const string GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
        string accept;
        using (var sha = SHA1.Create())
            accept = Convert.ToBase64String(sha.ComputeHash(Encoding.ASCII.GetBytes(key.Trim() + GUID)));

        string resp =
            "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Accept: " + accept + "\r\n" +
            "Access-Control-Allow-Origin: *\r\n\r\n";
        var head = Encoding.ASCII.GetBytes(resp);
        stream.Write(head, 0, head.Length);
        stream.Flush();

        client.SendTimeout = 3000;
        var junk = new byte[2048];
        try
        {
            SendText(stream, _hello());
            while (!_stop)
            {
                // 消费客户端可能发来的 ping/close 帧（浏览器一般不发，但防御式读取）
                try
                {
                    client.ReceiveTimeout = 1;
                    if (stream.DataAvailable)
                    {
                        int r = stream.Read(junk, 0, junk.Length);
                        if (r <= 0) break;
                        if ((junk[0] & 0x0F) == 0x08) break; // close
                    }
                }
                catch { }

                SendText(stream, _tick());
                for (int i = 0; i < 10 && !_stop; i++) Thread.Sleep(100);
            }
        }
        catch { }
    }

    private static void SendText(NetworkStream s, string text)
    {
        byte[] payload = Encoding.UTF8.GetBytes(text ?? "");
        int len = payload.Length;
        var frame = new MemoryStream(len + 10);
        frame.WriteByte(0x81); // FIN + text opcode
        if (len < 126) frame.WriteByte((byte)len);
        else if (len < 65536) { frame.WriteByte(126); frame.WriteByte((byte)(len >> 8)); frame.WriteByte((byte)(len & 0xFF)); }
        else { frame.WriteByte(127); for (int i = 7; i >= 0; i--) frame.WriteByte((byte)((long)len >> (8 * i))); }
        frame.Write(payload, 0, len);
        var arr = frame.ToArray();
        s.Write(arr, 0, arr.Length);
        s.Flush();
    }

    private static string GetHeader(string headers, string name)
    {
        if (string.IsNullOrEmpty(headers)) return null;
        foreach (var line in headers.Split('\n'))
        {
            int c = line.IndexOf(':');
            if (c <= 0) continue;
            if (line[..c].Trim().Equals(name, StringComparison.OrdinalIgnoreCase))
                return line[(c + 1)..].Trim();
        }
        return null;
    }

    public void Stop()
    {
        _stop = true;
        try { _listener?.Stop(); } catch { }
        try { _accept?.Join(300); } catch { }
    }

    public void Dispose() => Stop();
}

/// <summary>把 AppState / Hardware 序列化成前端友好的 JSON。</summary>
internal static class BridgeJson
{
    private static string S(Action<Utf8JsonWriter> build)
    {
        using var ms = new MemoryStream(16 * 1024);
        using (var w = new Utf8JsonWriter(ms)) build(w);
        return Encoding.UTF8.GetString(ms.ToArray());
    }

    private static double R(double v) =>
        double.IsNaN(v) || double.IsInfinity(v) ? 0 : Math.Round(v, 3);

    private static string Ver()
    {
        try { return typeof(AppForm).Assembly.GetName().Version?.ToString(3) ?? "0.0.0"; }
        catch { return "0.0.0"; }
    }

    private static string ColorTag(Color c)
    {
        if (c == Theme.Up) return "up";
        if (c == Theme.Down) return "down";
        if (c == Theme.Warn) return "warn";
        if (c == Theme.Gold || c == Theme.GoldSoft) return "gold";
        if (c == Theme.Blue) return "blue";
        if (c == Theme.Cyan) return "cyan";
        if (c == Theme.TextFade) return "fade";
        if (c == Theme.TextDim) return "dim";
        return "txt";
    }

    public static string Hello(AppState st, Hardware hw) => S(w =>
    {
        w.WriteStartObject();
        w.WriteString("app", "PerfTicker");
        w.WriteNumber("protocol", 1);
        w.WriteString("version", Ver());
        w.WriteString("cpu", st.CpuName ?? "");
        w.WriteString("gpu", hw?.GpuName ?? "");
        int cores = 0;
        foreach (var m in st.Metrics) if (m.Group == "处理器") cores++;
        w.WriteNumber("cores", cores);
        w.WriteStartArray("groups");
        foreach (var g in Catalog.GroupOrder) w.WriteStringValue(g);
        w.WriteEndArray();
        w.WriteStartArray("metrics");
        foreach (var m in st.Metrics)
        {
            w.WriteStartObject();
            w.WriteString("code", m.Code);
            w.WriteString("name", m.Name);
            w.WriteString("group", m.Group);
            w.WriteString("unit", m.Unit);
            w.WriteNumber("decimals", m.Decimals);
            w.WriteEndObject();
        }
        w.WriteEndArray();
        w.WriteStartArray("periods");
        foreach (var p in new long[] { 2000, 5000, 10000, 30000, 60000 }) w.WriteNumberValue(p);
        w.WriteEndArray();
        w.WriteNumber("intervalMs", st.IntervalMs);
        w.WriteNumber("periodMs", st.PeriodMs);
        w.WriteBoolean("redUp", st.RedUp);
        w.WriteBoolean("economy", st.Economy.Enabled);
        w.WriteString("selected", st.Metrics.Count > 0 ? st.Selected.Code : "000002");
        w.WriteEndObject();
    });

    public static string Tick(AppState st, Hardware hw) => S(w =>
    {
        var s = st.Snap ?? new Snapshot();
        w.WriteStartObject();
        w.WriteNumber("t", s.Tick);
        w.WriteNumber("wall", R(s.WallSeconds));
        w.WriteNumber("intervalMs", st.IntervalMs);
        w.WriteNumber("periodMs", st.PeriodMs);
        w.WriteBoolean("paused", st.Paused);
        w.WriteBoolean("redUp", st.RedUp);
        w.WriteNumber("cpu", R(s.CpuPct));
        w.WriteNumber("cpuAvgMHz", R(s.CpuAvgMHz));
        w.WriteNumber("cpuMaxMHz", R(s.CpuMaxMHz));
        w.WriteNumber("cpuPeakMHz", R(s.CpuPeakMHz));
        w.WriteString("cpuName", st.CpuName ?? s.CpuName ?? "");
        w.WriteStartArray("coresPct");
        foreach (var v in s.CorePct) w.WriteNumberValue(R(v));
        w.WriteEndArray();
        w.WriteStartArray("coresMHz");
        foreach (var v in s.CoreMHz) w.WriteNumberValue(R(v));
        w.WriteEndArray();
        w.WriteStartObject("mem");
        w.WriteNumber("used", R(s.MemUsedGB));
        w.WriteNumber("total", R(s.MemTotalGB));
        w.WriteNumber("pct", R(s.MemPct));
        w.WriteNumber("pageUsed", R(s.PageUsedGB));
        w.WriteNumber("pageTotal", R(s.PageTotalGB));
        w.WriteEndObject();

        var g = s.Gpu ?? new GpuInfo();
        w.WriteStartObject("gpu");
        w.WriteBoolean("ok", g.Available);
        w.WriteString("name", g.Name ?? "");
        w.WriteBoolean("nvml", g.Nvml);
        w.WriteNumber("util", R(g.UtilPct));
        w.WriteNumber("memUtil", R(g.MemUtilPct));
        w.WriteNumber("clock", R(g.ClockMHz));
        w.WriteNumber("memClock", R(g.MemClockMHz));
        w.WriteNumber("maxClock", R(g.MaxClockMHz));
        w.WriteNumber("memUsed", R(g.MemUsedMB));
        w.WriteNumber("memTotal", R(g.MemTotalMB));
        w.WriteNumber("temp", R(g.TempC));
        w.WriteNumber("power", R(g.PowerW));
        w.WriteNumber("powerLimit", R(g.PowerLimitW));
        w.WriteNumber("fan", R(g.FanPct));
        w.WriteEndObject();

        w.WriteStartObject("disk");
        w.WriteNumber("r", R(s.DiskReadMBps));
        w.WriteNumber("w", R(s.DiskWriteMBps));
        w.WriteNumber("busy", R(s.DiskBusyPct));
        w.WriteEndObject();
        w.WriteStartObject("net");
        w.WriteNumber("rx", R(s.NetRxMBps));
        w.WriteNumber("tx", R(s.NetTxMBps));
        w.WriteEndObject();

        w.WriteNumber("ctx", R(s.CtxSwitchPerSec));
        w.WriteNumber("procs", s.ProcCount);
        w.WriteNumber("threads", s.Threads);
        w.WriteNumber("handles", s.Handles);
        w.WriteNumber("uptime", R(s.UptimeSeconds));

        w.WriteStartArray("metrics");
        foreach (var m in st.Metrics)
        {
            w.WriteStartObject();
            w.WriteString("code", m.Code);
            w.WriteString("name", m.Name);
            w.WriteString("group", m.Group);
            w.WriteString("unit", m.Unit);
            w.WriteNumber("decimals", m.Decimals);
            w.WriteNumber("value", R(m.Value));
            w.WriteNumber("shown", R(m.Shown));
            w.WriteNumber("open", R(m.Open));
            w.WriteNumber("chg", R(m.Chg));
            w.WriteNumber("chgPct", R(m.ChgPct));
            w.WriteNumber("highPct", R(m.HighPct));
            w.WriteNumber("lowPct", R(m.LowPct));
            w.WriteString("chgText", m.ChgText);
            w.WriteString("text", m.Display);
            if (m.Group == "指数")
            {
                var sp = m.Spark(48);
                w.WriteStartArray("spark");
                foreach (var v in sp) w.WriteNumberValue(R(v));
                w.WriteEndArray();
            }
            w.WriteEndObject();
        }
        w.WriteEndArray();

        if (st.Metrics.Count > 0)
        {
            var m = st.Selected;
            w.WriteStartObject("selected");
            w.WriteString("code", m.Code);
            w.WriteString("name", m.Name);
            w.WriteString("unit", m.Unit);
            w.WriteNumber("decimals", m.Decimals);
            w.WriteNumber("value", R(m.Value));
            w.WriteNumber("shown", R(m.Shown));
            w.WriteNumber("chg", R(m.Chg));
            w.WriteNumber("chgPct", R(m.ChgPct));
            w.WriteNumber("highPct", R(m.HighPct));
            w.WriteNumber("lowPct", R(m.LowPct));
            w.WriteString("chgText", m.ChgText);
            w.WriteString("text", m.Display);
            w.WriteEndObject();
        }

        w.WriteStartArray("book");
        int bn = 0;
        foreach (var p in st.Procs)
        {
            if (bn >= 30) break;
            w.WriteStartObject();
            w.WriteNumber("pid", p.Pid);
            w.WriteString("name", p.Name ?? "");
            w.WriteNumber("cpu", R(p.CpuPct));
            w.WriteNumber("cpuNorm", R(p.CpuNorm));
            w.WriteNumber("gpu", R(p.GpuPct));
            w.WriteNumber("mem", R(p.MemMB));
            w.WriteNumber("delta", R(p.CpuDelta));
            w.WriteNumber("threads", p.Threads);
            w.WriteNumber("handles", p.Handles);
            w.WriteEndObject();
            bn++;
        }
        w.WriteEndArray();

        w.WriteStartArray("tape");
        int tn = 0;
        for (int i = st.Tape.Count - 1; i >= 0 && tn < 30; i--)
        {
            var e = st.Tape[i];
            w.WriteStartObject();
            w.WriteString("time", e.Time);
            w.WriteString("text", e.Text);
            w.WriteString("color", ColorTag(e.Color));
            w.WriteEndObject();
            tn++;
        }
        w.WriteEndArray();

        var eco = st.Economy;
        w.WriteStartObject("econ");
        w.WriteBoolean("on", eco.Enabled);
        w.WriteNumber("total", R(eco.Total));
        w.WriteNumber("rate", R(eco.Rate));
        w.WriteNumber("peak", R(eco.PeakRate));
        w.WriteStartArray("parts");
        foreach (var pt in eco.Parts)
        {
            w.WriteStartObject();
            w.WriteString("name", pt.Name);
            w.WriteNumber("load", R(pt.LoadShown));
            w.WriteNumber("net", R(pt.Net));
            w.WriteNumber("total", R(pt.Total));
            w.WriteString("full", pt.Full.ToString("0.#", CultureInfo.InvariantCulture));
            w.WriteEndObject();
        }
        w.WriteEndArray();
        w.WriteEndObject();

        w.WriteEndObject();
    });

    private struct Cnd { public long B; public double O, H, L, C, V; }

    private static List<Cnd> BuildCandles(Metric m, long period)
    {
        var list = new List<Cnd>(256);
        if (period < 1) period = 1000;
        long cur = -1;
        Cnd c = default;
        bool has = false;
        for (int i = 0; i < m.TickCount; i++)
        {
            var t = m.TickAt(i);
            long b = t.Ms / period;
            if (!has || b != cur)
            {
                if (has) list.Add(c);
                c = new Cnd { B = b, O = t.V, H = t.V, L = t.V, C = t.V, V = t.Vol };
                cur = b; has = true;
            }
            else
            {
                if (t.V > c.H) c.H = t.V;
                if (t.V < c.L) c.L = t.V;
                c.C = t.V; c.V += t.Vol;
            }
        }
        if (has) list.Add(c);
        if (list.Count > 240) list = list.GetRange(list.Count - 240, 240);
        return list;
    }

    public static string History(AppState st, string code, long period)
    {
        var m = st.ByCode(code);
        if (m == null) return "{\"code\":\"" + (code ?? "") + "\",\"candles\":[]}";
        if (period < 1) period = 5000;
        var candles = BuildCandles(m, period);
        return S(w =>
        {
            w.WriteStartObject();
            w.WriteString("code", m.Code);
            w.WriteString("name", m.Name);
            w.WriteString("unit", m.Unit);
            w.WriteNumber("decimals", m.Decimals);
            w.WriteNumber("period", period);
            w.WriteStartArray("candles");
            foreach (var c in candles)
            {
                w.WriteStartObject();
                w.WriteNumber("t", c.B);
                w.WriteNumber("o", R(c.O));
                w.WriteNumber("h", R(c.H));
                w.WriteNumber("l", R(c.L));
                w.WriteNumber("c", R(c.C));
                w.WriteNumber("v", R(c.V));
                w.WriteEndObject();
            }
            w.WriteEndArray();
            w.WriteEndObject();
        });
    }

    public static string Spark(AppState st, string code, int n)
    {
        var m = st.ByCode(code);
        if (m == null) return "{\"code\":\"" + (code ?? "") + "\",\"v\":[]}";
        if (n < 2) n = 40;
        if (n > 300) n = 300;
        var v = m.Spark(n);
        return S(w =>
        {
            w.WriteStartObject();
            w.WriteString("code", m.Code);
            w.WriteStartArray("v");
            foreach (var x in v) w.WriteNumberValue(R(x));
            w.WriteEndArray();
            w.WriteEndObject();
        });
    }
}

/// <summary>
/// 无头采样核心：不依赖任何 UI，供 --sensor 模式给壁纸持续供数。
/// 逻辑与 AppForm.Ingest 同源（指标推送 / 进程历史 / 硬件探测 / 逐笔事件 / 营收结算），
/// 但刻意不引用 WinForms 控件，方便在无窗口进程里跑。
/// </summary>
internal sealed class SensorCore : IDisposable
{
    public readonly Sampler Sampler;
    public readonly AppState St = new();
    public readonly Hardware Hw = new();
    private readonly object _sync = new();
    public object Sync => _sync;

    private long _lastTick = -1;
    private bool _hwProbed;
    private bool _firstIngest;
    private readonly Dictionary<int, double> _prevCpu = new(1024);
    private HashSet<int> _prevPids = new();
    private Dictionary<int, string> _prevNames = new();
    private readonly System.Diagnostics.Stopwatch _clock = System.Diagnostics.Stopwatch.StartNew();
    private double _ecoMark;

    public SensorCore(int intervalMs)
    {
        intervalMs = Math.Clamp(intervalMs, 250, 20000);
        Sampler = new Sampler { IntervalMs = intervalMs };
        St.IntervalMs = intervalMs;
        St.PeriodMs = 5000;
        if (St.PeriodMs < intervalMs * 2L) St.PeriodMs = SmallestPeriod(intervalMs);
        St.RedUp = true;
        St.ApplyColorMode();
        St.Metrics = Catalog.Build(Sampler.Cores);
        St.CpuName = Sampler.CpuName;
        St.SelectedIndex = Math.Min(1, Math.Max(0, St.Metrics.Count - 1));
        St.Economy.Enabled = true;
    }

    private static long SmallestPeriod(int ms)
    {
        long need = ms * 2L;
        foreach (var p in new long[] { 2000, 5000, 10000, 30000, 60000 })
            if (p >= need) return p;
        return 60000;
    }

    public void Pump()
    {
        lock (_sync)
        {
            var s = Sampler.Latest;
            if (!St.Paused && s.Tick != _lastTick && s.Tick > 0)
            {
                _lastTick = s.Tick;
                Ingest(s);
            }
            Accrue();
        }
    }

    private void Accrue()
    {
        if (!St.Economy.Enabled) { _ecoMark = _clock.Elapsed.TotalSeconds; return; }
        double now = _clock.Elapsed.TotalSeconds;
        double dt = _ecoMark <= 0 ? 0 : now - _ecoMark;
        _ecoMark = now;
        if (dt > 0) St.Economy.Accrue(dt, St.Snap);
    }

    private void Ingest(Snapshot s)
    {
        var prev = St.Snap;
        St.Snap = s;
        long now = Environment.TickCount64;
        double vol = Math.Max(0, s.CtxSwitchPerSec);
        St.VolPerSample = vol;

        foreach (var m in St.Metrics) m.Push(m.Read(s), now, vol);

        foreach (var p in s.Procs)
        {
            if (_prevCpu.TryGetValue(p.Pid, out double pc)) p.CpuDelta = p.CpuPct - pc;
            _prevCpu[p.Pid] = p.CpuPct;
            if (!St.ProcHist.TryGetValue(p.Pid, out var h)) { h = new ProcHist(); St.ProcHist[p.Pid] = h; }
            h.Push(p.CpuPct);
        }
        if (_prevCpu.Count > 4000) _prevCpu.Clear();
        if (St.ProcHist.Count > 1200)
        {
            foreach (var key in St.ProcHist.Keys.Where(k => !_prevCpu.ContainsKey(k)).Take(600).ToList())
                St.ProcHist.Remove(key);
        }

        if (!_hwProbed && s.Procs.Count > 0)
        {
            _hwProbed = true;
            Hw.GpuDriver = Sampler.GpuDriverVersion;
            Hw.Probe(s, s.Gpu);
            St.Economy.ApplyWeights(Hw);
            St.GpuName = s.Gpu?.Name ?? "";
            AddTape($"硬件探测完成 · {Hw.LogicalCores} 线程 / {Hw.MemTotalGB:0}G 内存", Theme.Blue);
        }

        St.Procs = s.Procs;
        SortProcs();
        DetectEvents(prev, s);
        if (St.Metrics.Count > 0) St.Selected.RebuildCandles(St.PeriodMs);
    }

    private void SortProcs()
    {
        Comparison<ProcSample> cmp = St.ProcSort switch
        {
            0 => (a, b) => b.CpuPct.CompareTo(a.CpuPct),
            1 => (a, b) => b.GpuPct.CompareTo(a.GpuPct),
            2 => (a, b) => b.MemMB.CompareTo(a.MemMB),
            _ => (a, b) => b.Threads.CompareTo(a.Threads),
        };
        if (!St.ProcSortDesc) { var inner = cmp; cmp = (a, b) => inner(b, a); }
        St.Procs.Sort(cmp);
    }

    private void DetectEvents(Snapshot prev, Snapshot s)
    {
        if (!_firstIngest)
        {
            _firstIngest = true;
            AddTape($"行情接入完成 · 已载入 {St.Metrics.Count} 项自选 · {Sampler.Cores} 逻辑核", Theme.Gold);
        }

        var curPids = new HashSet<int>(s.Procs.Count);
        var curNames = new Dictionary<int, string>(s.Procs.Count);
        foreach (var p in s.Procs) { curPids.Add(p.Pid); curNames[p.Pid] = p.Name; }

        if (_prevPids.Count > 0)
        {
            int added = 0;
            foreach (var p in s.Procs)
            {
                if (_prevPids.Contains(p.Pid) || p.Pid == 0 || added >= 2) continue;
                AddTape($"新进 {Trim(p.Name)}  ·  {p.Pid}", Theme.Blue);
                added++;
            }
            int removed = 0;
            foreach (var pid in _prevPids)
            {
                if (curPids.Contains(pid) || removed >= 2) continue;
                _prevNames.TryGetValue(pid, out var nm);
                AddTape($"退出 {Trim(nm)}  ·  {pid}", Theme.TextFade);
                removed++;
            }
        }
        _prevPids = curPids;
        _prevNames = curNames;

        double df = s.CpuAvgMHz - prev.CpuAvgMHz;
        if (Math.Abs(df) >= 220 && prev.CpuAvgMHz > 0)
        {
            string dir = df > 0 ? "拉升" : "回落";
            AddTape($"CPU 主频{dir} {(df > 0 ? "+" : "")}{df / 1000.0:0.00}GHz → {s.CpuAvgMHz / 1000.0:0.00}GHz",
                df > 0 ? Theme.Up : Theme.Down);
        }
        if (s.Gpu.Available && s.Gpu.TempC >= 82 && prev.Gpu.TempC < 82)
            AddTape($"GPU 温度告警 {s.Gpu.TempC:0}°C", Theme.Warn);
        if (s.Gpu.Available && s.Gpu.UtilPct >= 92 && prev.Gpu.UtilPct < 92)
            AddTape($"GPU 负载触顶 {s.Gpu.UtilPct:0}%", Theme.Warn);
        if (s.CpuPct >= 88 && prev.CpuPct < 88)
            AddTape($"CPU 负载预警 {s.CpuPct:0}%", Theme.Warn);
        if (s.MemPct >= 90 && prev.MemPct < 90)
            AddTape($"内存水位 {s.MemPct:0}% 逼近上限", Theme.Warn);
        if (s.DiskReadMBps >= 200 && prev.DiskReadMBps < 200)
            AddTape($"磁盘突发读取 {s.DiskReadMBps:0}MB/s", Theme.Cyan);

        var hot = s.Procs.Count > 0 ? s.Procs[0] : null;
        if (hot != null && hot.CpuPct >= 22 && hot.CpuDelta > 8)
            AddTape($"主力异动 {Trim(hot.Name)} CPU {hot.CpuPct:0.0}%", Theme.Up);

        int ticks = 0;
        foreach (var p in s.Procs)
        {
            if (ticks >= 2) break;
            if (Math.Abs(p.CpuDelta) < 1.2) continue;
            AddTape($"{Trim(p.Name)}  {p.CpuPct:0.0}%  {(p.CpuDelta > 0 ? "▲" : "▼")}{Math.Abs(p.CpuDelta):0.0}",
                p.CpuDelta > 0 ? Theme.Up : Theme.Down);
            ticks++;
        }
    }

    private static string Trim(string s)
    {
        if (string.IsNullOrEmpty(s)) return "未知";
        return s.Length > 22 ? s[..22] + "…" : s;
    }

    private void AddTape(string text, Color color)
    {
        long now = Environment.TickCount64;
        if (St.Tape.Count > 0)
        {
            var last = St.Tape[^1];
            if (last.Text == text && now - last.Ms < 5000) return;
        }
        St.Tape.Add(new TapeEvent
        {
            Ms = now,
            Time = DateTime.Now.ToString("HH:mm:ss"),
            Text = text,
            Color = color
        });
        if (St.Tape.Count > 240) St.Tape.RemoveRange(0, St.Tape.Count - 240);
    }

    public void ApplyCommand(string cmd, string arg)
    {
        lock (_sync)
        {
            switch ((cmd ?? "").ToLowerInvariant())
            {
                case "pause":
                    St.Paused = !St.Paused;
                    break;
                case "color":
                    St.RedUp = !St.RedUp;
                    St.ApplyColorMode();
                    break;
                case "select":
                {
                    int i = St.Metrics.FindIndex(m => m.Code == arg);
                    if (i >= 0) St.SelectedIndex = i;
                    if (St.Metrics.Count > 0) St.Selected.RebuildCandles(St.PeriodMs);
                    break;
                }
                case "period":
                {
                    if (long.TryParse(arg, out long p) && p >= St.IntervalMs * 2L)
                    {
                        St.PeriodMs = Math.Max(500, p);
                        if (St.Metrics.Count > 0) St.Selected.RebuildCandles(St.PeriodMs);
                    }
                    break;
                }
                case "interval":
                {
                    if (int.TryParse(arg, out int iv))
                    {
                        iv = Math.Clamp(iv, 250, 20000);
                        St.IntervalMs = iv;
                        Sampler.IntervalMs = iv;
                    }
                    break;
                }
                case "economy":
                    St.Economy.Enabled = !St.Economy.Enabled;
                    break;
                case "procsort":
                {
                    if (int.TryParse(arg, out int ps))
                    {
                        if (St.ProcSort == ps) St.ProcSortDesc = !St.ProcSortDesc;
                        else { St.ProcSort = ps; St.ProcSortDesc = true; }
                        SortProcs();
                    }
                    break;
                }
            }
        }
    }

    public void Dispose()
    {
        try { Sampler.Dispose(); } catch { }
    }
}
