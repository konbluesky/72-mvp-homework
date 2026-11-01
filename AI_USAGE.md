# AI 协作与验证记录

日期：2026-10-31。工具：Codex主agent与三个并行子agent；本地shell/npm/Vitest/Fastify inject/Playwright；agent-browser-cli操作真实Chrome；FFmpeg实际音频解码；Docker/Compose。使用agent-browser-cli技能指导页面调试，PDF技能读取原始需求，OpenAI Docs技能核对GPT结构化输出文档。未调用真实付费模型，不需要用户第三方key。

## 分工

主agent读取任务书、原始PDF和设计资料，建立实施计划、共享协议、workspace/CI/Docker/文档，独立交叉审查并运行集成与页面验收。web agent实现Vue舞台、录音意图、轮次控制、播放调度与Rive边界；server agent实现HTTP、会话/回执、Graph、取消与超时；providers agent实现配置、GPT/CF/Deepgram/R2、私有媒体与离线语音。

所有agent共用工作目录，按模块分工避免覆盖；未创建额外用户聊天、远程仓库或发布到外部环境。原始设计文件保留。

## 自动发现并修复的真实问题

1. **浏览器fetch的this绑定**：注入的fetch在ApiClient上作为方法调用，真实Chrome报`Illegal invocation`，会话无法创建；HappyDOM替身未揭示。主agent用agent-browser-cli执行实际client定位，修为绑定globalThis，并新增要求this===globalThis的回归用例。随后跨应用测试可创建会话并真实播放。
2. **取消与冻结快照竞态**：浏览器先abort SSE，服务器可能先保守冻结；随后携带“已经呈现但未送达”的回执的新begin被拒。改为临时保守冻结只拒普通迟到回执，首次显式冻结快照可补确认，随后不可扩充。增加真实HTTP断流→冻结快照→新轮用例。
3. **照片失败后的环境误提交**：最初仅在同一句内记photoFailed，跨片段的雨势事件可能误执行。补服务端事件前置与前端跨片段保护，照片失败不提交photo或依赖环境事实。
4. **音频时长不能信客户端**：初稿只校验durationMs。调研发现MediaRecorder WebM常无Duration，元数据库不可靠；增加受限FFmpeg实际解码/样本计数，验证五种格式与16秒伪报短录音拒绝。
5. **类型与构建门禁**：Vue Test Utils的get()返回值没有exists()方法类型，单测运行通过但完整typecheck/Docker构建失败；调整为find()/正确断言后复核构建。

这些是本次工具日志与代码测试可追溯的问题，不是虚构人工审查案例。

## 验证边界

自动验证的具体数量与命令见各阶段验收摘要（见 [Live2D 记录](docs/acceptance/live2d-migration.md)与 [Deepgram 记录](docs/acceptance/deepgram-integration.md)）。截图经主agent视觉检查；Chrome调试与Playwright录音使用自动化，假麦克风证明MediaRecorder/上传/解码调度，不证明真人音质或真实STT。Mock波形由eSpeak NG离线生成，与同一字幕文本对应。

**用户人工验收：未执行。** 真实麦克风权限弹窗/听感、iOS Safari、Android Chrome、正式Rive与真实Provider账户均待验证。若交付演示视频，它是自动浏览器操作的屏幕录像，并非真人录音或Live证明。未独立记录可追溯人工工时，不填写估算数字。

## 2026-10-31 Live2D改造追加记录

用户选择引用聊天中的二次元方向后，主agent通过read_thread核对方案，三个子agent并行实现runtime、舞台及独立验收。主agent核验31条上游哈希并发布21条必要资产，保留官方Haru/Core许可及技术替身说明。

真实Chrome联调发现：legacy wrapper的URL resolver会把`blob:http://`改成`blob:http//`。同源原始模型能渲染但隔离纹理路径失败；通过公开Cubism4ModelSettings实例的受控resolveURL边界修复，原版vendor保持原字节。第二个修正是Pixi autoDensity写inline尺寸导致canvas脱离父尺寸变化，改为观察父容器并显式限制DPR。验收使用原生WebGL draw中的实际像素、真实Analyser RMS、WEBGL_lose_context扩展与可控visibility竞态，没有用状态字符串冒充渲染成功。

成功显示新角色后移除旧SVG人物与Rive分支，保留历史设计资料。最终结果见[Live2D验收](docs/acceptance/live2d-migration.md)；Haru不等同原创Mira，真人听感/正式模型/真机仍未验证。

## 云端识别适配移除（2026-10-31）

按用户要求删除识别Provider、配置字段、成对校验、env条目及相应测试；Provider超时/取消回归改用Deepgram继续覆盖。新增Live录音拒绝与后续文字恢复测试、前端录音入口保护。先前章节是初次工程创建记录，不代表识别适配仍存在。当前真实服务只包含用户GPT与Deepgram（媒体可选R2）。本轮未调用付费服务。

## Deepgram完整接入与OOD（2026-10-31）

后续用户要求统一Deepgram识别/合成并为其他Provider调试做准备。实现独立能力接口、具体适配类与组合入口、共用Deepgram传输、前端能力协商、脱敏逐阶段诊断。实际读取Deepgram官方模型/语言、预录音频REST及Flux批量TTS文档；受控HTTP/Graph/浏览器测试不使用真实密钥。显式真实小样本：一次机械Mock音频识别为空（正确NO_SPEECH）、一次Flux短句合成成功、生成音频转WAV后的Nova-3识别成功、一次用户GPT Provider在LangGraph内结构化规划成功。没有真人录音/听感或真机验收，不将受控浏览器称为真实云端联调。

新增浏览器用例最初把 /src/api/client.ts 也匹配到API代理路由，导致页面未挂载；改为按pathname前缀/api/选择后通过。此问题来自测试路由，不是供应商或产品页面故障。旧机械样本的空识别保留在验收记录，没有改成固定假转录。

## 源码仓库整理（2026-10-31）

按当前 Live2D/Deepgram 实现梳理提交范围，排除历史研究与设计、密钥、私有媒体、依赖、编译产物及原始验收输出。本次只做静态/资产/Git内容检查，不新增功能、运行时或E2E执行记录；上文的历史验证不代表本次重跑。截图、录像和原始证据保留在本地，不随公开仓库发布。

## WebGAL 路线 B 开始实施（2026-10-31）

主 agent 读取引用聊天中确认的完整 WebGAL 宿主、场景/角色注入与保留 Scheduler 方案，单独实施 B0，没有调用子 agent。固定提交导入完整引擎/parser，接入 React 工作台、模式锁、舞台初始化所有权、根工具链与来源检查。统一 React 18 解决既有 LangGraph SDK 的 peer 范围，并修复完整类型检查暴露的上游回调/文本节点类型。原有用户未提交页面和验收修改保留。

本轮仅静态检查与构建；生命周期竞态测试新增但未执行，未调用真实 Provider 或运行浏览器。实际结果与 B1–B4 缺口见 [WebGAL 迁移记录](docs/acceptance/webgal-migration.md)。默认产品入口在迁移门槛满足前保留。

## WebGAL B0 浏览器验证（2026-10-31）

用户明确要求检查已在 VS Code 启动的服务，并授权使用 agent-browser-cli。主 agent 使用该技能操作真实 Chrome，验证实际 WebGL 像素、单舞台、12 个原生入口拒绝、HMR 销毁、受控初始化失败/重试和 390×844 尺寸；相关 26 个测试通过。旧 Vite 进程未加载迁移配置的问题通过配置重载恢复，无需修改别名。

对现有 Live 页面进行了 5 次文字输入：GPT/Deepgram TTS 回复、照片与雨势独立回执、播放中打断及下一轮恢复均有实际证据；中断回复未记入历史，已呈现事实保留。没有调用真实麦克风/STT，没有导出音频、token 或供应商密钥。合成点击触发的音频手势限制通过 CDP 真实鼠标重试确认，未误改音频代码。补齐 favicon 消除 404；详细结果见迁移记录，B1–B4 状态保持待实施。

## 2026-10-31：上下文关联的发言推荐

移除前端“接一句”的关键词候选，Live改为在既有LangGraph规划调用中与台词一起生成ReplyPlan.suggestions，通过reply.done传输。候选由唯一播放调度器等待整轮呈现完成后展示，取消/过期清理，视觉失败抑制；点击仍只填入可编辑输入框。Mock提供明确的后端模拟候选。

核对了官方OpenAI Structured Outputs文档，沿用现有ChatOpenAI结构化输出调用，无新增外部请求或模型选择。新增协议边界、同次规划上下文、播放/视觉完成、字幕确认及迟到取消测试代码；按AGENTS本轮未执行功能/E2E/运行时测试，也没有Live付费探测。已运行typecheck、ESLint、生产build、OpenAPI生成及一致性校验，均通过。

## 2026-10-31：语音推荐与消息预览

移除推荐仅在文字模式显示的限制，语音模式也能选择候选并转为可编辑草稿。新增鉴权transcription预览接口，复用实际STT与录音校验；确认前不写history、不调用planner/TTS。前端区分识别中/待确认，提供编辑、确认发送、重录与取消；确认只提交修改后的文字，不重复识别。保持上传与迟到响应的轮次所有权，自动录音结束后的指针释放不会丢弃草稿。

新增接口隔离、重复识别幂等、确认编辑文字和取消迟到结果测试代码，更新真实录音E2E与录制脚本的确认步骤。按照AGENTS未运行功能、E2E或运行时测试，未调用真实付费Provider；验证范围为静态类型、lint、格式、构建和生成契约。

## WebGAL 可见示例追加（2026-10-31）

按用户要求将空工作台改为可直接确认引擎能力的示例。主 agent 绘制两份原创 SVG，经原生背景同步、rain 和 transform 渲染，增加运行证据侧栏及首页导航。用 agent-browser-cli 实测原生粒子运动、16 次切换、镜头值和延迟资产/舞台重建竞态；新增 3 条浏览器回归与原生命周期 4 条单测通过。本轮没有调用付费 Provider、生成音频或采集麦克风。完整产品迁移仍未完成，未用示例结果替代 B1–B3 验收。

## HTTP/SSE连接可靠性扩展

Codex核查了现有上传、SSE、媒体、取消与回执，沿用HTTP/SSE并实现独立心跳、HTTP RTT、退避重连、会话恢复和过期提示。避免将监测重连变成业务POST重发或将心跳成功当作Provider健康。补充所有权、超时、背压和恢复测试源码；受AGENTS约束，本轮未执行功能/E2E/运行时测试或真实模型探测。静态检查/构建/契约校验与实际断网、音频验收明确区分。

## 语音空转录排查与修正

依据用户提供的HTTP200/NO_SPEECH日志与代码核查，修正MediaRecorder最终数据块与tracks释放顺序，增加收尾deadline和重复回调防护；NO_SPEECH独立422、前端语音错误与连接错误分离。增加不含录音/转录的能量摘要，并压低正常健康请求日志。离线capabilities核对nova-3/zh-CN，官方语言表支持该组合；没有付费探测、重放用户录音或声称已经完成真实语音验收。竞态/契约测试源码已补，本轮按AGENTS只进行静态检查、构建与契约产物更新。

## Miara + WebGAL 八场景接入（2026-10-31）

本轮由 Codex 主代理完成：单舞台角色驱动、headless 状态、结构化场景事件/回执、Graph 场景策略、八个原创 SVG 背景与离线故事语音。使用 agent-browser-cli 手动调试 Mock 页面；未执行功能/运行时/E2E 测试套件，也未使用真实麦克风或付费 Provider。发现 Miara 头部默认值偏转到参数上限，改用真实范围校准基础姿态；还修正了角色加载迟到时可能重复销毁资源的问题，补充对应测试源码。实际检查与未验边界见八场景实施记录。

## 2026-10-31：Ink剧情控制与推荐软联动

在现有scenario目录内接入inkjs2.4.0，迁移咖啡馆八地点、三幕与三结局内容；保留SessionManager/Graph/Scheduler边界。阅读官方Ink的choice tags、保存恢复与Compiler资料，按已确认呈现前缀提交存档，并加入父存档hash防止旧分叉覆盖。角色、道具正文与导演提示进入同一故事包，普通模型不再直接产生世界事件。

按用户明确要求，仅复用已启动dev服务，用agent-browser-cli实际操作页面；没有运行dev/start/docker up命令。当前页为Live，使用正常UI做有界聊天与TTS走查，没有provider probe或打印凭证。已观察旅行闲聊推荐不强推主线、读信后解锁选择、离店门头打断和改回窗边。选择tag位置与礼貌问句重复确认是实际发现并修正的问题，具体结果见Ink接入记录。

新增/更新对应测试源码，按AGENTS不执行功能、运行时、E2E套件。静态、构建、契约、Ink及资产来源检查按本轮日志记录；其他会话已有结果不转记为本轮。用户人工验收和移动真机未执行。

## 2026-11-01：场景模块边界收口

将地点、道具、阶段、环境和事实的具体值从共享协议改为由当前故事包校验；SessionManager注入场景，Graph与动作确认复核继续复用。前端Host注入SceneModule，产品壳从模块读取品牌、人物、阶段和锚点；布局/前景进入cafe地点文件，模型差异进入角色profiles。Mock内容移入cafe包。Ink编译器生成严格筛选的公开呈现manifest，资源校验按各模块声明执行。

保留并行会话的持续对话、推荐一键发送、语音预览、最新菜单布局和explicit动作确认代码。未手动启停或另起dev服务；未执行功能/E2E/运行时测试或外部Provider调用。新增测试源码覆盖新地点/阶段/事实、候选存档隔离、未声明内容拒绝和渲染绑定；验证范围为静态检查、构建、资产及契约。
