using System.Runtime.InteropServices;

namespace PerfTicker;

internal static class Program
{
    private const string WakeMessage = "PerfTicker.Wake.v1";
    private static readonly IntPtr HWND_BROADCAST = new(0xFFFF);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterWindowMessage(string name);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);

    [STAThread]
    private static void Main(string[] args)
    {
        // 无头模式：只跑采样 + 数据桥，供 Wallpaper Engine 的 Web 壁纸持续取数。
        if (HasFlag(args, "--sensor"))
        {
            RunSensor(args);
            return;
        }

        using var mutex = new Mutex(true, @"Local\PerfTicker.SingleInstance.v1", out bool created);
        if (!created)
        {
            // 已有实例：广播唤醒消息（首实例收到后会把窗口从托盘唤出），然后自身退出
            try
            {
                uint msg = RegisterWindowMessage(WakeMessage);
                if (msg != 0) PostMessage(HWND_BROADCAST, msg, IntPtr.Zero, IntPtr.Zero);
            }
            catch { }
            return;
        }

        Diag.Init();
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        // 兜底：任何未捕获异常都进日志，不静默消失
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (s, e) => Diag.Error("UI-THREAD", e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (s, e) => Diag.Error("DOMAIN", e.ExceptionObject as Exception);

        Application.Run(new AppForm());
    }

    private static bool HasFlag(string[] args, string flag)
    {
        if (args == null) return false;
        foreach (var a in args)
            if (string.Equals(a, flag, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static int ArgInt(string[] args, string name, int fallback)
    {
        if (args == null) return fallback;
        for (int i = 0; i < args.Length - 1; i++)
            if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)
                && int.TryParse(args[i + 1], out int v)) return v;
        return fallback;
    }

    /// <summary>
    /// 无头传感器模式：常驻托盘（不显示主窗），采样线程 + 回环 HTTP 数据桥。
    /// 可作为壁纸的常驻数据源，也可与主程序并存（端口自动顺延）。
    /// </summary>
    private static void RunSensor(string[] args)
    {
        Diag.Init();
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        int interval = Math.Clamp(ArgInt(args, "--interval", 1000), 250, 20000);
        int port = ArgInt(args, "--port", BridgeServer.DefaultPort);

        SensorCore core = null;
        BridgeServer bridge = null;
        NotifyIcon tray = null;
        Thread pump = null;
        bool stop = false;

        try
        {
            core = new SensorCore(interval);
            bridge = BridgeServer.ForSensor(core);
            bridge.Start(port);

            pump = new Thread(() =>
            {
                while (!Volatile.Read(ref stop))
                {
                    try { core.Pump(); } catch (Exception ex) { Diag.Error("SENSOR", ex); }
                    Thread.Sleep(200);
                }
            })
            { IsBackground = true, Name = "PerfTicker.SensorPump" };
            pump.Start();

            tray = new NotifyIcon
            {
                Icon = Art.MakeAppIcon(),
                Visible = true,
                Text = "PerfTicker 数据桥 " + bridge.Url
            };
            var menu = new ContextMenuStrip { ShowImageMargin = false };
            menu.Items.Add("数据接口 " + bridge.Url, null, (s, e) =>
            {
                try
                {
                    string dir = System.IO.Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PerfTicker");
                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(dir) { UseShellExecute = true });
                }
                catch { }
            });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出数据桥", null, (s, e) => Application.Exit());
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += (s, e) =>
            {
                try
                {
                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(
                        System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PerfTicker"))
                    { UseShellExecute = true });
                }
                catch { }
            };

            Application.Run(new ApplicationContext());
        }
        catch (Exception ex)
        {
            Diag.Error("SENSOR-INIT", ex);
        }
        finally
        {
            Volatile.Write(ref stop, true);
            try { pump?.Join(500); } catch { }
            try { bridge?.Stop(); } catch { }
            try { core?.Dispose(); } catch { }
            try { if (tray != null) { tray.Visible = false; tray.Dispose(); } } catch { }
        }
    }

    internal static uint RegisterWakeMessage() => RegisterWindowMessage(WakeMessage);
}
