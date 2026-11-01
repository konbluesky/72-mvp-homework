# WebGAL 路线 B 实施记录

> 原版 `/` 与 WebGAL `/webgal.html` 按用户要求并存，原版仍为默认首页；以下 B0/Vue 描述保留为历史阶段记录。最新范围与验证边界见[八场景实施记录](miara-webgal-story.md)。

日期：2026-10-31。分支：`codex/webgal-host`。本轮是完整宿主迁移的 B0 构建基座，产品默认入口仍是既有 Vue/Live2D 版本。

| 阶段                                 | 当前状态                                | 尚需完成                                               |
| ------------------------------------ | --------------------------------------- | ------------------------------------------------------ |
| B0 源码、parser、工具链、React 样板  | 已实现；静态与 Chrome 浏览器验证通过    | 后续场景/角色不在 B0 验证范围                          |
| B1 Headless + React 输入字幕         | 待实施                                  | Pinia 解耦、Mock 交互链、录音与回执                    |
| B2 interactive Bridge/ScopedExecutor | 待实施；B0 仅增加模式与原生推进入口防护 | 所有媒体/perform/资源/动画的 owner、取消和独立呈现语义 |
| B3 Haru 与咖啡馆场景                 | 待实施                                  | Cubism4 单入口、四态三情绪、照片/雨势、移动布局        |
| B4 验证和交付                        | 待实施                                  | 竞态、浏览器/真机/Live、录屏与正式原创资产             |

## 本轮代码

- 从固定提交 `15173bc21339a65da34b78463fca8a304e4d503a` 完整归档导入 Core/Stage/UI/store/hooks/parser；不依赖稀疏研究 checkout 或 `tmp`。
- 单一根 npm 锁文件和 workspace 构建；统一 React 18.3.1、Pixi 6.5.10、wrapper 0.5.19。保留完整 MPL、素材许可和逐文件原始哈希/补丁清单。
- `/webgal.html` 为独立 React 迁移工作台，初始化真实 WebGAL PixiStage；同一页面不挂载 Vue 舞台或旧 Live2D vendor。
- Core 导入前锁定 interactive；SDK 构造不自动加载；阻止原生 bootstrap、脚本、推进、auto/fast 入口。工作台当前不执行任何业务 cue 或音频。
- 初始化 attempt 与舞台 lease 各自校验身份；取消、重试、卸载和 HMR 旧结果不取得新舞台的所有权。
- 修正完整类型检查暴露的上游 legacy 文本节点类型及 React 18 DOM 回调类型问题，未放宽 strict 或全局关闭 noImplicitAny。
- 新增静态源码/依赖检查，更新根 dev/build 和前后端 Docker 安装层。

## 验证边界

只记录本轮实际完成的静态命令，不复用历史功能验收：

- `node scripts/project.mjs ci`：通过，使用 Node 26.13.0 / npm 11.20.0 和根锁文件。
- `node scripts/project.mjs typecheck`：通过；协议、parser、server、Vue、完整引擎/React 宿主和 tools 均进入检查。
- `node scripts/project.mjs build`：通过；生成原产品和 WebGAL 工作台两个独立 HTML 入口。
- `node scripts/project.mjs lint`、`format:check`：通过。
- `node scripts/project.mjs contracts:check`：通过；HTTP/SSE schema 与 OpenAPI 无变更。
- `node scripts/project.mjs assets:check`：通过，21 条现有 Live2D SHA-256；原模型/vendor 未改动。
- `node scripts/project.mjs webgal:check`：通过，304 条上游来源记录、14 条声明补丁/扩展/可选字体排除；锁文件中的 React/Pixi/wrapper 各一套。

新增 `engine-lifecycle.test.ts` 覆盖迟到初始化与新舞台交错、重复初始化、失败重试、同任务取消与模式锁。B0 编码阶段仅保留源码，未执行功能或浏览器测试；后续用户明确要求检查功能，执行记录见下节。

Haru 新 wrapper、正式手机场景布局与 Bridge 呈现事务仍未迁移。B0 工作台不能作为这些能力已迁移的证据。后续恢复只能使用合法已呈现/冻结回执投影；禁止把原生存档或舞台 commit 作为会话事实。

## 用户授权后的浏览器检查

同日使用用户通过 VS Code 启动的服务，由 `agent-browser-cli` 操作真实 Chrome。调试标签独立于用户已有页面；未采集真实麦克风或保存用户音频。

| 检查            | 结果与实际证据                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 开发态启动      | 初始进程早于迁移配置更新，出现 `Outdated Optimize Dep` 和别名解析失败；触发 Vite 重载配置后恢复，未修改别名代码                                |
| 真实 WebGL 绘制 | 在实际引擎 stage 临时绘制探针，`readPixels` 得到 `[255, 0, 255, 255]`；随后移除探针；上下文未丢失                                              |
| 单舞台与副作用  | 1 个 canvas、Pixi 6.5.10；未加载旧 Cubism/vendor、原生 game 资源或调用 API，没有 audio/video DOM                                               |
| 模式治理        | 12 个 native bootstrap/script/next/forward/auto/fast 入口均受控拒绝；无法从 interactive 切换到 story                                           |
| HMR 重建        | 旧 Application `destroy` 调用 1 次，旧 stage 的 `currentApp` 清空，替换为新实例，仍只有 1 个 canvas                                            |
| 初始化失败/重试 | 受控注入 `ResizeObserver` 构造失败：canvas 与全局舞台引用清空，旧 WebGL 上下文释放；恢复原 API 并点击“重试舞台”后成功                          |
| 移动尺寸        | 390×844 Chrome 设备模拟，无横向溢出；canvas 与容器均为 348×504，恢复桌面尺寸后仍为单 canvas                                                    |
| 现有 Live 对话  | 5 次文字输入中 4 次完整音频回复、1 次在真实播放中打断；后续新轮正常。验证了 GPT 规划/Deepgram TTS 的现有产品路径，未执行 STT                   |
| 实际口型输入    | 观察到 981 个 speaking 采样帧，实际播放包络峰值 1；声音真实启动后投影 speaking                                                                 |
| 独立事实回执    | photo 与 environment 分别收到 presented/HTTP 200；服务端快照确认 `photo_revealed=true`、`rain_softened=true`、`environment=rain-soft`          |
| 打断与事实保留  | 观察到原生 AudioBufferSourceNode.stop；下一帧为 idle/action none。被打断回复不进入服务端 history；已呈现事实保留；下一轮正常完成且不再显示照片 |
| 声音恢复        | CLI 合成点击未获得音频手势，正确出现显式恢复；使用 CDP 真实鼠标点击重试后 AudioContext 从 suspended 变 running 并实际播放，非解码/供应商失败   |

两入口重新加载后正常：工作台为单 canvas、原页面为 live2d，控制台均无 error；favicon 返回 200/image/svg+xml，调试探针已清理。

相关 5 个测试文件共 **26 个测试通过**：`engine-lifecycle`、`audio`、`scheduler`、`turn-controller`、`character-stage`。未运行 Playwright 全量 E2E 或启动器 runtime suite；上述浏览器结果来自实际 Chrome 操作。

检查同时补齐两个 HTML 入口的同源 favicon，消除缺少 `/favicon.ico` 的 404。本地截图和脱敏结果保存在 `outputs/webgal-browser-check/`，不纳入版本控制。未保存 token、供应商密钥或录音。

这些结果不证明 WebGAL 版对话/Haru 已实现，也不证明真机 iOS/Android、真人听感、STT 或正式原创角色已验收。引擎上下文丢失后的产品恢复属于后续阶段。

开发方式与后续步骤见[迁移开发入口](../development/webgal-migration.md)。

## 可见引擎示例追加

用户指出空舞台无法直观看出 WebGAL 能力后，B0 工作台补上两个本项目内置示例，并在当前首页新增“WebGAL 演示”入口。这里尚未完整集成产品对话或角色；页面明确列出 B1–B3 未完成项。

- 背景实际经过 `StageStateManager → syncPixiStageState → PixiStage.addBg`；使用原创本地 SVG。夜间/傍晚可以切换。
- 原生 `rain` 产生前/背景共 200 个粒子，原生 ticker 推进实际位置；关闭后粒子 0、原生动画 0、ticker 停止。
- 镜头控制修改引擎背景对象的 scale，112% 时实际值 1.12；没有借用 DOM/CSS 缩放冒充引擎变换。
- 场景定义通过组合入口注入通用视觉端口；未开放任意脚本、外部 URL、网络对话、音频或剧情回执。
- 生命周期增加 asset ready 与绘制帧的 revision/owner 检查；销毁清除等待帧、雨图层和 ticker。上游 AssetManager 新增 renderer detach，避免晚到加载访问旧 renderer。当前有 15 条声明补丁/扩展/排除。

实际验证：agent-browser-cli 操作真实 Chrome，连续 16 次切换后始终 1 个 canvas、1 个背景对象；动画句柄在 0/2 间切换，粒子在 0/200 间切换，纹理条目固定 3，GL error 为 0，API 请求数为 0。受控挂起旧舞台纹理完成、重建新舞台后再放行：旧舞台背景对象为 0、renderer 已 detach，新舞台未被覆盖。截图保留在本地 outputs。

新增 `tests/e2e/webgal.spec.ts` 的 3 条浏览器回归已通过，覆盖场景切换/原生镜头、活动雨效重建销毁、旧资源完成与新舞台交错；仅针对示例页面，未请求 Provider。原生命周期 4 条单测继续通过。类型、构建和静态检查按本轮结果记录，历史 Live 检查不代表本轮重跑。

可见示例在 390×844 设备模拟下无横向溢出，canvas 为 356×200；首页导航已实际点击并成功进入示例。最终 typecheck、build:web、lint、format:check、assets:check、webgal:check 和 Git 空白检查通过。未将其他并行任务的修改纳入本次结果归因。
