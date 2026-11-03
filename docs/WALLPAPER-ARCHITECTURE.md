# PerfTicker 壁纸化 · 架构与方案复盘

> 本文记录「把 PerfTicker 做成壁纸」的最终架构，**以及原方案（初版设计）中被发现的问题与修正**。
> 对应需求：「功能全部保留 + 可导入 Wallpaper Engine 作壁纸」；结论：**壁纸形态物理上无法「功能全部保留」，
> 采用「壁纸只读展示 + 原生面板操作台」的双形态，功能面 100% 保留在原生程序，壁纸负责 7×24 的可视化呈现。**

## 一、最终形态

```
        ┌───────────────────────────────┐
        │  PerfTicker.exe                │
        │   ├─ 主程序（无边框窗口/托盘）  │──┐  ForForm
        │   └─ --sensor（无头采样+托盘）  │──┤  ForSensor
        │        SensorCore ─ Sampler     │  │
        │        BridgeServer (TcpListener)│ ◄┘
        └───────────────┬────────────────┘
                        │ 127.0.0.1:51789+  WS 推送 / HTTP
        ┌───────────────▼────────────────┐
        │  Wallpaper Engine · Web 壁纸    │
        │  wallpaper/index.html (Canvas)  │
        └─────────────────────────────────┘
        交互：Ctrl+Alt+P → 唤出原生主面板
```

两种数据源共用同一个 `BridgeServer` 与同一份 JSON 契约：
- `BridgeServer.ForSensor(SensorCore)`：无头模式用，采样在后台线程，桥直接读锁保护的状态。
- `BridgeServer.ForForm(AppForm)`：主程序用，桥把读请求 `Invoke` 回 UI 线程，命令回投给 `AppForm.ApplyBridgeCommand`。
- 传输双通道：`GET /ws`（WebSocket，手写 RFC6455 帧）连上先发 hello、之后每秒推 tick；`/api/*` HTTP 轮询为兼容/回退通道。壁纸优先 WS，断线自动重连并退回轮询。

## 二、原方案的缺陷与修正（「不好的地方」）

| # | 原方案的问题 | 后果 | 修正 |
|---|---|---|---|
| 1 | Bridge 只嵌在 `AppForm`（主窗口）里 | 壁纸想取数必须开着主窗口；主窗口最小化会走省电分支、且单实例 mutex 让第二个进程起不来 | 新增 `--sensor` 无头模式：`SensorCore` 独立采样 + 托盘常驻，可与主程序并存；主程序也内置 `ForForm` 桥。双形态 |
| 2 | 固定端口 + 固定密钥 | 端口被占就整条链路失效；密钥硬编码也挡不住本机网页 | 端口从 `51789` 顺延最多 20 个；壁纸端自动扫端口发现；命令接口改用「自定义请求头 + CORS 预检」防护（见 #4） |
| 3 | 计划用 `HttpListener` | 需要 URL ACL / 管理员权限，普通用户直接 500 或拒绝访问 | 自实现 `TcpListener` 最小 HTTP/1.1，回环绑定，**零管理员权限** |
| 4 | `POST /api/cmd` 对任意网页开放 | 任意网页可 CSRF 到 `127.0.0.1` 改状态 | 强制请求头 `X-Requested-With: PerfTicker`（简单请求无法自带，跨站会触发 CORS 预检被拦）；命令白名单仅 UI 状态类，**不含结束进程 / 下载执行** |
| 5 | 想把 K 线历史塞进每帧 `tick` | 每帧几十 KB～上百 KB，1s 一推带宽/CPU 浪费 | `tick` 只发增量快照（实测 ~15KB）；K 线走独立 `/api/history?code=&period=`，按需聚合；`spark` 仅「指数」组内嵌 |
| 6 | 直接复用宿主 `Metric` 聚合 | 无 UI 时 `Tween/Selected` 为空，K 线/选中标的全空 | `SensorCore` 复刻最小 `Ingest`（指标 Push、进程 ProcHist/CpuDelta、Hw.Probe、DetectEvents、Selected.RebuildCandles） |
| 7 | 全局热键只在主程序注册；命名管道唤醒未落地 | 主程序退出后无法唤出面板 | `RegisterHotKey(Ctrl+Alt+P)` + 既有窗口消息广播双通道，`WM_HOTKEY → RestoreFromTray()` |
| 8 | 未处理 WE 的「暂停壁纸」行为 | 全屏应用/省电模式下壁纸停更，用户以为坏了 | 属 WE 行为，无法从壁纸侧改；文档明确说明（关闭省电暂停，或接受暂停），桥端采样不受影响、恢复即最新 |
| 9 | 未考虑 DPI / 多分辨率 | 高分屏模糊、超宽屏错位 | Canvas 按 `devicePixelRatio` 自适应 + 弹性布局；已在 1080p / 1440p 实拍验证 |
| 10 | 壁纸端打算读 `bridge.json` 找端口 | CEF 沙箱内 `file://` 读不到 `%LOCALAPPDATA%` 文件 | 壁纸改为**端口扫描发现**（51789–51808），不依赖文件系统 |
| 11 | 前后端 JSON 无固定契约 | 字段漂移，改一处崩一片 | `BridgeJson` 固定 schema，README 记录契约；字段名一处定义 |
| 12 | `--sensor` 无窗口，用户无法退出 | 进程只能任务管理器杀 | `--sensor` 加 `NotifyIcon` 托盘 + 「退出数据桥」菜单 |
| 13 | 曾考虑 WE `Application` 类型壁纸（直接跑 exe） | WE 2.8.42 起已把 Application 类型移出创意工坊；且与壁纸层抢 Z-order 会黑屏/闪烁（原 README 已记录） | 放弃该路线，改 Web 壁纸 + 原生数据桥——可上创意工坊、稳定 |
| 14 | 原方案只做 HTTP 轮询 | 1s 轮询有延迟，多客户端时连接/开销叠加 | 增加 WebSocket 推送（`/ws`）：连上即推、延迟更低；前端优先 WS，失败/断开自动退回 HTTP 轮询 |

## 三、指标与数据（壁纸能「功能全部保留」到什么程度）

壁纸实时呈现的内容（与原生面板同源）：

- 三大指数卡：CPU 综合指数（GHz）、CPU 负载（%）、内存占用（%）+ 迷你走势；
- 主 K 线图：当前标的的 K 线 + MA5/10/20 + 成交量 + 价格刻度 + 末价标记；
- 标的详情：当前值、涨跌、最高/最低；
- 处理器核心网格：逐核占用（24/32 核自适应列数）；
- 五档盘口（活跃进程 Top8）+ 进程监控表（PID/CPU/GPU/内存/线程/句柄）；
- 逐笔成交 / 事件流（温度、频率、磁盘、网络、进程异动）；
- 营收中心：累计 / 速率 / 峰值 + 分项。

壁纸不做（回到原生）：指标切换、K 线周期切换、暂停、配色切换、进程排序、搜索、导出等**交互**——因为 Web 壁纸点击被桌面图标层拦截、键盘不被转发（详见原方案「交互为什么被砍掉」）。这些通过 `Ctrl+Alt+P` 唤出原生面板完成。

## 四、验证记录（本次交付实测）

- `dotnet build -c Debug`：**0 警告 0 错误**（自包含 win-x64）。
- 无头桥实测（`--sensor --port 51789`，真实机器 Intel i7-14650HX / RTX 5060 Laptop / 24 核）：
  - `/api/hello` → `version 1.5.0, cores 24`；
  - `/api/tick` → 长度 ~15051，含 24 核 `coresPct/coresMHz`、mem、gpu(NVML)、disk；
  - `/api/history` → 返回 candles；`/api/spark` 正常；
  - `POST /api/cmd` 不带防护头 → **403**（CSRF 防护生效）。
- 壁纸实拍（Edge headless，加载本地 HTTP 服务 + 连接真实桥）：1080p / 1440p 均正确渲染并显示 `LIVE` 实时数据。
- WebSocket 实测：`ClientWebSocket` 连 `ws://127.0.0.1:51789/ws` → 首帧 hello（~4.7KB）、次帧 tick（~16.6KB，含 `t`/`coresPct`），握手 `101 Switching Protocols` 成功。

## 五、里程碑状态

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 原生数据桥（Bridge.cs / 协议 / CSRF） | ✅ 完成并实测 |
| M2 | `--sensor` 无头采样 + 托盘 | ✅ 完成并实测 |
| M3 | Web 壁纸 Canvas 复刻（指数/K线/盘口/进程/逐笔/营收） | ✅ 完成（1080p/1440p 实拍） |
| M4 | 热键唤起原生面板 + 只读展示定位 | ✅ 完成 |
| M5 | 工程打包（project.json/README/预览图） | ✅ 完成；正式 `.pkg` 上架需在 WE 编辑器内导出 |

## 六、残余风险

- Wallpaper Engine 导入与 `.pkg` 发布需在本机 WE 编辑器完成（本环境无法自动化验证 UI 导入）。
- GPU 指标依赖 NVML，仅 NVIDIA；A 卡/核显为占位（与原生一致）。
- WE 版本差异可能导致 CEF 对某些 Canvas 特性支持不同；已在 Chromium 内核（Edge 同源）验证，WE 内如有异常优先更新 WE。
