# Miara + WebGAL 八场景实施记录

日期：2026-10-31（Asia/Shanghai）。范围：《雨停之前：最后一盏灯》的代码与本地资源接入；历史 B0、其他聊天的测试结果不计入本轮。

2026-11-01 用户调整：WebGAL 默认角色改回 Haru，菜单保留 Miara 显式可选；原版页面继续默认 Haru，两个页面共存。未启动服务，未运行功能、运行时或 E2E 测试。此前端口与浏览器调试记录均为历史状态，本轮启动的服务已按用户要求停止。

## 用户反馈后的入口修正

原版页面恢复为默认首页 `/`，`/legacy.html` 保留同一原版；新故事页面保留在 `/webgal.html`，两套页面共存。原版的录音预览/编辑、文字与语音切换、对话显示、回看、音频恢复和打断代码没有删除；本次只补版本入口和实际模式标识，不以新 UI 替代原 UI。两个版本入口可在新标签页打开，保留当前会话。

用户原有 `.env` 为 APP_MODE=live，GPT/Deepgram 配置存在且配置校验有效。原 :5175 预览连 :3001，是本轮曾显式启动的 Mock 调试服务；并非 Live 失败后回退。该调试入口不作为 Deepgram 验收结果。正常 :5173→:3000 的会话模式为 Live；两套页面的声音都由同一 ProviderSet 决定，页面与角色不切换 Provider。

当前 :5175 预览已改为代理用户现有 :3000 Live 服务，已停止本轮启动的 :3001 Mock 后端与 :5174 Mock 开发页。:5173 和 :5175 的 /readyz 均返回 live，创建会话也返回 mode=live、voiceInput=true；未调用付费 planner/TTS 或真实麦克风做验证。旧 Mock 页面需刷新后建立新的 Live 会话。

本次修复只恢复 HTML 入口、保留两套 UI、补充可见版本链接和连接后模式标签；未删除 Vue 录音/对话组件，未修改用户的 .env、Deepgram 接口或 Provider 选择规则。

以下为此前实现记录，其中默认入口和独立 Mock 端口描述按此修正为准。

## 当前入口与实际实现

- `/webgal.html`：React/WebGAL 互动产品。默认 Haru；“故事菜单 → 外观与连接”可显式切换 Miara，全部既有 Haru 文件、旧加载器、poster 与归属保留。没有静默回退。
- `/webgal.html?preview=1`：原 B0 引擎示例，保留原有背景、雨和镜头调试。
- `/` 和 `/legacy.html`：原版 Vue/Haru 对话页面，原实现保留；八地点与新剧情以默认 WebGAL 入口为准。

产品提供八个独立的本地 SVG 背景：街角远景、门头、大堂、窗边座位、照片墙走廊、公共洗手区、吧台结账台、店外街道。另有三个打烊变体，变体不计入八背景数量。背景来源、尺寸与 SHA-256 见 `apps/web/public/assets/cafe-story/SOURCES.json`，生成源码为 `scripts/create-cafe-art.py`。采用已有 SVG 风格；本轮未调用图像生成 API。

| 范围         | 代码实现与边界                                                                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单舞台与角色 | 同一 WebGAL Pixi Application、figure 容器与原生动画管理器；同源 Cubism Core + 固定 wrapper 的 cubism4 入口。关闭 SDK 自动 ticker、随机 idle 与声音。Miara 加载读取真实参数范围，未知索引不作为能力 |
| 参数动作     | 新编抬手、思考偏头、望窗回看参数曲线；照片/信件共用低头关注通道。原始 Idle/Tap/Flic 仅在集成信息中显式、有界预览。音频口型最终覆盖，未播放时闭嘴                                                   |
| 同页对话     | React 复用同一 TurnController、BrowserAudio、PlaybackScheduler、连接监测与录音草稿；抽出 headless 状态，Pinia 只用于兼容页                                                                         |
| 地点与剧情   | 可信地点图、固定线索、三种结尾由服务端场景策略组织；Graph 注入 ScenarioDefinition。纯导航与资料浏览可用确定性 Graph 分支，不额外调用 planner/TTS                                                   |
| 演出与输入   | 移动、读信、留信、营业牌/招牌状态、小雨与结局都经同一轮次和 Scheduler。真实声音开播才 speaking；纯场景事件使用 presentation.ready，不伪造音频 URL                                                  |
| 事实与取消   | location/prop/ambience/ending 独立回执；结局依赖前置语音和视觉目标。按服务端事件顺序应用可覆盖状态；取消冻结回执，迟到回执不倒退新地点                                                             |
| 故事连续性   | 信封不是信件正文；未读信的离店文案不引用展览邀请。照片拒绝不阻断其他路径；天气改由离店节点触发，不再依赖看照片                                                                                     |
| Mock         | 补充九条离线故事/上下文台词，音频总数十八；eSpeak NG/cmn，本地生成，manifest 有文本与哈希。未请求付费 Provider                                                                                     |
| 图形与声音   | 背景通过原生 StageStateManager 同步；原生 rain 使用室内窗口遮罩，室外独立雨层；原生动画管理器执行转场。镜头预览变换同一舞台，不写故事事实                                                          |

业务身份仍为原创成年 Mira；Miara/Haru 都是官方技术样例，正式原创视觉资产尚未交付。没有 `.cmo3/.can3`，本轮不声称完成连续走路、坐站、抓握或专用递纸模型动画，跨地点使用受控剪辑与构图。

## 操作步骤

1. 开始进入街角，可走近门头或直接进店。打开“地点地图”访问不同空间；大堂可去座位、照片墙与吧台，走廊可到洗手区。
2. 在座位自由输入或请求照片；按住说话入口跟随服务端 voiceInput，松开先预览识别稿，确认后才提交。Mock 识别稿明确是模拟内容。
3. 到吧台请求打开信：先播放她的回应，再展示信纸。正文显示成功后，后续对话才能承接阿岚来过与展览邀请。
4. 选择“一起出去走走”“留下回信再告别”或“再坐一杯”。三种结尾分别落到街道、门前、座位，改变道具、营业状态或灯光；不按固定时间自动触发。
5. 新输入、录音或“打断”立即取消当前声音与尚未完成的演出。菜单换角进入同一取消边界；角色加载失败时可以重试或显式选择另一角色。
6. “集成信息”提供参数范围、三种新编动作、三段原始 motion、镜头与小雨的有界预览；预览不更新剧情事实。

## 本轮静态检查

按 AGENTS.md 未运行功能、运行时或 E2E 测试套件。新增/更新契约、纯呈现队列、场景规则、冻结与迟到回执、角色加载交错等测试源码，未将源码存在表述为测试通过。

执行范围：固定 Node/npm 下的 typecheck、lint、build、contracts:generate / contracts:check、assets:check、webgal:check、格式与 Git 空白检查。最终结果以本轮工具输出为准。资源检查确认 29 条 Live2D 来源哈希、8 个基础背景与 3 个变体；WebGAL 来源检查保留 304 条固定上游记录与 15 条声明补丁。

协议现为 schemaVersion=2。新增严格的 interaction 输入、presentation.ready、场景事件与回执、故事快照，生成 OpenAPI 已更新。前后端需协调升级并刷新旧页面，不与旧 v1 严格客户端混用。

## 手动浏览器调试与未验证范围

使用 agent-browser-cli 操作独立 Chrome 标签与 Mock 服务。没有采集真实麦克风、调用付费 Provider 或保存用户录音。

已观察：单 canvas 渲染 Miara；模型有 138 个实际参数，头部/嘴/眼/手臂范围实际读取，compiled moc 的部件数为 45（CDI 名称不等同于实际部件）。街角→大堂→吧台→打开信→离店主线的背景、语音、信件与结尾实际呈现。离店时使用 street-walk-closed 本地背景，雨势缓和；该路线没有请求照片，验证天气与照片分别推进。

补记：显式切换到 Haru 时确认加载 `/assets/live2d/haru/Haru.model3.json`；同页舞台重建后舞台 UUID 改变，当前位置仍为吧台，canvas 仍为 1。已手动观察“再坐一杯”分支的窗边与桌灯。390×844 Chrome 模拟中页面宽度与 scrollWidth 均为 390，没有横向溢出。

当前独立 Mock 预览为 `http://127.0.0.1:5175/`（API :3001）；与正常开发配置隔离，未改用户的 Live 配置。正常 `npm run dev` 仍使用项目配置的 :5173 / :3000。

截图保存在本地 `outputs/miara-implementation/`，不进入版本控制。截图和手动观察不代替完整业务回归。真实麦克风/STT、真人听感、iOS/Android 真机、完整 Live 链路和生产网络未在本轮验收；其余具体调试补记在交付说明中。

## 代码入口

- 前端组合：`apps/web/src/webgal/product/host.ts`、`product/App.tsx`。
- 原生舞台：`webgal/runtime/`、`webgal/scenes/cafe/`；角色：`webgal/characters/driver.ts`。
- 后端策略：`apps/server/src/scenario/ports.ts`、`cafe.ts`、`story.ts`；Graph 与 SessionManager 复用原实现。
- 严格契约：`packages/protocol/src/index.ts`、`story.ts`；实际来源：本地模型、背景与 Mock 音频 manifest。

最终补记：全仓 lint 通过；最后一次全仓 format:check 在本轮未修改的新增文件 `apps/server/src/scenario/cafe/compiled.json`、`lore.json`、`manifest.json` 和 `scripts/compile-scenario.ts` 上报告四项格式告警。本轮宿主、角色、场景、协议与交接文档另做定向格式检查；未覆盖写入这四个文件。

定向检查补记：最新检查还在 `packages/protocol/src/index.ts`、`packages/protocol/src/story.ts`、`apps/server/src/scenario/ports.ts` 报告格式告警；因此不把最终全仓格式检查记为通过。其余已通过的构建、类型、lint、协议与资产检查仍对应各自执行时的工作区状态。

入口修复验证：本次 typecheck、build:web 和修改的 Vue/React/入口文件定向格式检查通过；原版与新版在 :5175 均可创建 Live 会话（未向对话 input 路由提交文本/音频）。全仓 lint 仍在正在修改的 conversation.ts 两处未使用回调参数上报错，本次未改动这些后端回调。

原版会话兼容补记：原版客户端创建 entry=conversation 会话，直接在窗边进入自由对话；WebGAL 使用 entry=story。原版不受新故事进店、读信和结局门槛限制；原版请求照片后恢复照片→雨势缓和反馈，照片/环境仍各有独立回执，新故事路径不变。相关兼容测试源码已补充，按 AGENTS.md 未执行测试套件。

## 2026-11-01 持续会话调整

当前 WebGAL 从大堂的角色邀约进入，近期对话、推荐和输入始终可见；点击自然推荐句即发送玩家发言，录音仍先预览编辑再确认。地点列表移入故事菜单，用户可以在会话中表达看照片、读信、移动和关键选择。旧版上方“操作步骤”的地图/独立剧情按钮描述作为历史记录保留，当前交互以[持续会话说明](../architecture/webgal-interaction-design.md)为准。物件直接点选的第 4 点仍待定，现有观察能力保留。

关键动作需要完整输入证据、confirmed 和当前合法动作/revision 校验，explicit 动作在 Graph 内单独复核；回执确认与取消冻结继续由原调度器及 SessionManager 处理。本轮补充回归测试源码，未运行功能、运行时或 E2E 测试，未调用付费 Provider。静态验证结果由本轮交付单独记录，不沿用上方历史功能验收结论。
