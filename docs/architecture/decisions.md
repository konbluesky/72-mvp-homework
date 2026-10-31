# 实施决策记录

## ADR 001 — 单进程与职责边界（已实现默认）

依据任务书及 Node.js 选型：Vue 3/Vite 与标准 Node/Fastify 独立构建，npm workspaces 共用 Zod 协议。后端 LangGraph 管单轮编排；SessionManager 管跨轮事实和当前任务所有权。Graph 无 MemorySaver、无人机审批 interrupt。前端控制器管理轮次，Pinia 仅 UI 投影，PlaybackScheduler 是音频与演出的唯一调度者。

不引入账号、DB、Redis、Workers 后端或通用 Agent 平台。会话有界且仅在内存，重启后要求重新进入。部署限一个进程/副本。

## ADR 002 — 版本锁定（官方核验）

2026-10-31 从 [Node 官方发布清单](https://nodejs.org/dist/index.json) 核验 `v26.13.0`（2026-10-28，LTS Lithium，npm 11.20.0）。本机原为 26.5.0，不作为最终验收版本。`.nvmrc`、engines、CI、Docker 统一 26.13.0；npm 统一 11.20.0。根 package-lock 是唯一锁文件，生产编译使用 ESM 真实 exports，无跨应用源码引用。

TypeScript 固定 5.9.3；各直接依赖采用核验过的精确版本。Node 生命周期参考 [官方 Release schedule](https://github.com/nodejs/Release/blob/main/schedule.json)。

## ADR 003 — 播放才形成事实（关键不变量）

新输入先本地失效旧轮、停止音频、清空字幕和瞬时演出，再请求 begin。录音权限意图单独标识，松手后迟到的授权结果立即 stop tracks。服务端以单调 generation 判定 owner；旧 cancel/stream finally 只能作用于原任务。

计划是 proposed。音频 onended 后提交 segment 回执；图片解码并在页面呈现后提交 photo 回执；环境改变单独提交 environment 回执。只有合法、确实下发且在冻结快照内的回执能 committed。reply.done 仅表示生成结束，正常 SSE EOF 后允许当前有效播放继续。

取消/下一轮 begin 携带累计未确认回执与冻结快照，在构造新上下文之前原子合并。迟到回调不扩充旧快照。已确认剧情保留，临时照片撤下。

## ADR 004 — 分离故障预算与交互目标

Provider 自有调用 timeout；FIRST_AUDIO_TIMEOUT_MS 初值 20 秒在接收 input 后计时，首 audio.ready 解除。NEXT_SEGMENT_TIMEOUT_MS 限制后续供应商等待。TURN_MAX_LIFETIME_MS 初值 120 秒覆盖生成、背压和呈现等待。SSE 心跳与客户端 idle timeout、下载/解码保护单独管理。未测真实供应商延迟，不报告 P50/P95 或成本。

## ADR 005 — 素材与服务验证状态分开

无凭证默认 Mock+Local；只有 Provider 边界替换，HTTP/Graph/媒体/播放/回执/取消均共用。中文 Mock 语音是明确标识的离线合成素材；模拟 STT 返回固定示例，不假装理解任意录音。

当前角色为真实 Live2D/Haru 技术替身；旧 SVG/Rive 方案已移除，不能作为静默回退。原创 Mira 模型、专用手势及真机表现仍需独立交付。模型、音色由用户配置，不自动替换为其他供应商。Live 缺配置直接失败。

## ADR 006 — 验证真实录音时长

MediaRecorder产生的WebM可能没有Duration元数据，客户端durationMs也不能作为安全上限。因此语音路径使用受限FFmpeg解码到16kHz单声道PCM，按实际样本数验证15秒（最多250ms编码尾部）。限制输入/输出、2并发、5秒、协议/格式白名单，无shell/外部URL；取消立即结束子进程。此依赖有具体兼容性与校验职责，文字路径不依赖它；Docker内置，本地/CI明确安装。

## ADR 007 — Live2D 二次元渲染替换旧贴片

2026-10-31，用户基于「探索 Live2D 设计方案 (2)」选择二次元方向并要求改造成功后剔除旧贴片。主项目改为真实 Cubism/Pixi 模型渲染，默认使用探索已核验的 Haru 技术替身；该资源不是原创 Mira，也不具备其专用服装或递照片手势。角色能力映射与模型参数从实际资产核验，白名单业务意图不能指定文件路径或代码。

此次替换只影响前端渲染边界。PlaybackScheduler 继续独占声音、字幕、动作及呈现回执；Live2D 消费状态与实际音频能量，不自播音频、不发剧情事实、不接收 Provider 输出中的任意 URL。背景、雨势和暖光为独立场景层，照片实际可见后仍单独确认事实。

模型加载与每个异步资源均有所有者和取消信号；独立手动 ticker 限制30 FPS、DPR≤1.5，禁用样例自动动作和交互。重试、隐藏、卸载和 WebGL context loss 必须释放资源并屏蔽迟到结果。reduced motion 冻结装饰运动，但保留可辨表情和实际嘴型。

新实现通过真实浏览器及回归门禁后删除原主应用 SVG 人物拼片、专属 CSS 动画和未使用的 Rive 分支/依赖。原探索稿和历史文档只在本地保留，不进入运行包或公开源码仓库。结果与缺口见 [Live2D改造验收](../acceptance/live2d-migration.md)。ADR 005 中 SVG/Rive 描述是前一阶段交付，不再作为当前角色实现依据。

## ADR — 移除云端识别适配（2026-10-31）

按用户最新要求删除外部识别Provider、专属配置及校验。ProviderSet的转录能力为可选，当前仅Mock实现。Live录音入口禁用，Graph对直接录音请求在解码和Provider调用前返回UNSUPPORTED_AUDIO；文字对话、Deepgram语音回复、Mock采集/打断/回执以及R2存储保留。原设计中识别服务的描述按历史方案处理。

## ADR — 统一Deepgram与能力组合（2026-10-31）

后续按用户要求完整接入Deepgram识别与合成，取代上一条仅支持Live文字的中间状态。采用SpeechToTextProvider/ReplyPlanner/TextToSpeechProvider接口与组合factory，避免Graph绑定具体供应商。Nova-3/zh-CN识别和既有Flux中文合成共用key，模型/超时独立。显式禁用STT由会话capabilities告知页面，不静默回退。独立诊断命令默认离线，真实stage调用和CI受控测试分开。当前接口对应按住录音REST和句级合成；完整双工/WebSocket不在本次范围。
