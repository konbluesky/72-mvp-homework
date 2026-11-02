# 角色互动平台：当前组件、职责与交互时序

2026-11-01，按当前工作区源码梳理。本文描述已写入代码的交互，不以历史设计稿代替现状；未启动服务、执行功能/运行时/E2E 测试或调用真实供应商。标准 UML 源文件见 [program-interactions.puml](program-interactions.puml)；本页用 Mermaid 展示相同的主要关系。

## 1. 先看整体

程序有两套浏览器宿主，共享一个独立 Node/Fastify 后端：

- `/legacy.html`：Vue 原版对话页，`entry=conversation`，通过原版 Live2D 渲染器展示 Haru。
- `/`（默认）与 `/webgal.html`：React + WebGAL 故事页，`entry=story`，默认 Haru，Miara 可显式选择。`?preview` 是本地引擎工作台，不是另一套后端故事系统。
- 两套宿主复用 `TurnController`、`PlaybackScheduler`、API、SSE 和回执协议，但拥有各自的页面状态与渲染适配。
- Live：Deepgram STT → GPT 兼容接口规划 → Deepgram TTS。Mock：替换这三个 Provider；后端会话、Graph、HTTP、媒体、播放和回执链路继续复用。

**五个关键角色：Ink 决定合法剧情；LLM 理解输入并生成内容；LangGraph 编排一轮处理；PlaybackScheduler 控制浏览器播放呈现；SessionManager 提交确认后的事实。**

## 2. 组件交互图

实线表示调用或数据流，虚线表示代码依赖或构建产物关系。图中的 Provider 是能力接口，Live 和 Mock 是可替换的实现。

```mermaid
flowchart TB
    User[用户]
    subgraph Browser[浏览器 · apps/web]
        Vue[Vue 对话页 /]
        React[React 故事页 /webgal.html]
        Controller[TurnController + ApiClient\n输入、轮次、取消、回执同步]
        Scheduler[PlaybackScheduler\n统一播放与呈现调度]
        Audio[BrowserAudio\n下载、解码、播放、实际音量]
        Presentation[场景呈现适配\n照片、正文、地点、环境、结局]
        WebGAL[WebGAL 原生舞台 + Pixi\n背景、分层、雨效、动画]
        Actor[CharacterDriver + profiles\nHaru / Miara]
        Legacy[Vue CharacterStage\nscene/live2d 渲染器]
        Live2D[Live2D / Cubism 模型运行时]
        WebScene[前端场景包\n资源、布局、环境映射]
        Monitor[ConnectionMonitor\n独立心跳、探测、恢复]
    end
    subgraph Shared[共享代码 · packages]
        Protocol[protocol\nZod、DTO、事件、回执、身份]
        Parser[webgal-parser\nWebGAL DSL / 样式解析依赖]
    end
    subgraph Backend[Node / Fastify · apps/server]
        HTTP[HTTP 边界\n鉴权、输入校验、SSE、私有媒体]
        Session[SessionManager\n当前轮、历史、事实、存档、回执]
        Graph[LangGraph\n单轮编排与校验]
        Scenario[ScenarioDefinition / InkScenario\n合法动作、上下文、候选 beat]
        Ink[inkjs\n在独立解释器副本中运行 Ink]
        Story[服务端故事包\nInk、角色、Lore、manifest、作者台词]
        STT[SpeechToTextProvider]
        Decode[受限 FFmpeg\n录音解码、实际时长校验]
        Planner[ReplyPlanner / GptPlanner]
        TTS[TextToSpeechProvider]
        Media[MediaService\n音频校验、ID、归属、有效期]
        Store[LocalMediaStore / R2MediaStore]
    end
    subgraph External[外部服务 · 仅 Live]
        Deepgram[Deepgram HTTP API\n识别与合成]
        LLM[GPT / OpenAI 兼容 LLM API]
    end
    User --> Vue
    User --> React
    Vue --> Controller
    React --> Controller
    Controller -->|有效 SSE 事件入队| Scheduler
    Scheduler --> Audio
    Audio -->|实际音量驱动口型| Scheduler
    Scheduler --> Presentation
    Scheduler -->|状态、情绪、动作、口型投影| Actor
    Scheduler -->|原版页面投影| Legacy
    Scheduler -->|实际完成或失败回执| Controller
    WebScene -.-> Presentation
    Presentation -->|WebGAL 宿主| WebGAL
    Actor -->|共享舞台与 ticker| WebGAL
    Actor --> Live2D
    Legacy --> Live2D
    Controller -->|JSON / multipart / cancel / receipts| HTTP
    HTTP -->|POST SSE| Controller
    Audio -->|鉴权 GET /api/media/:assetId| HTTP
    Monitor -->|独立 GET SSE / ping / 读取快照| HTTP
    HTTP --> Session
    HTTP --> Graph
    HTTP -->|预览转录，不进入回复 Graph| Decode
    Decode --> STT
    Graph --> Session
    Graph --> Scenario
    Session -->|仅回执确认后 accept checkpoint| Scenario
    Scenario --> Ink
    Story -.-> Scenario
    Graph -->|兼容直接 audio input| Decode
    Graph --> Planner
    Graph --> TTS
    STT --> Deepgram
    TTS --> Deepgram
    Planner --> LLM
    Graph --> Media
    HTTP -->|私有音频读取| Media
    Media --> Store
    Vue -.-> Protocol
    React -.-> Protocol
    Controller -.-> Protocol
    Scheduler -.-> Protocol
    HTTP -.-> Protocol
    Graph -.-> Protocol
    Scenario -.-> Protocol
    WebGAL -.-> Parser
    Story -.->|scenarios:build 生成公开 manifest| WebScene
```

注意：`packages/protocol` 是双方导入的代码包，不是网络中转服务；实际网络连接是浏览器与 Fastify 之间的 HTTP/SSE。共享包的准确拼写是 `protocol`，不是 `protocal`。

## 3. 边界与职责

| 组件                                     | 负责什么                                                                              | 边界                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Vue / React 产品 UI                      | 输入、录音草稿、近期对话、菜单、建议、错误；展示状态投影                              | 不保管权威剧情，不自行调用模型或提交 Ink 状态                                                       |
| TurnController                           | 创建/恢复会话、begin/input、校验事件身份和连续序号、打断、草稿确认、回执同步          | 不决定剧情；正常流结束后不停止仍有效的队列                                                          |
| PlaybackScheduler                        | 排队、音频与字幕、动作/口型状态、视觉呈现调用、完成/失败回执、建议发布                | 是交互回应的唯一播放调度入口；不把 `reply.done` 当成已播放                                          |
| BrowserAudio                             | 经 API 下载音频、解码、播放/停止、实际音量采样和结束回调                              | 不调用 TTS，不决定模型台词和故事进度                                                                |
| 前端场景包                               | 本地资源绑定、地点布局、前景、环境预设、照片/正文/转场呈现                            | 不复制服务端私有 Lore 和剧情条件；资源地址由可信配置映射                                            |
| WebGAL / Pixi                            | 原生舞台、资源生命周期、容器、背景、特效、动画与渲染                                  | 当前宿主为 `interactive`；原生剧本推进、自动播放、快进等入口受模式门禁限制，避免第二套故事/播放时钟 |
| Live2D / Cubism                          | 将状态、情绪、动作和口型映射为模型参数与画面                                          | 不理解语言，不生成声音，不确认剧情事实；WebGAL 页与 Vue 页使用不同适配器                            |
| `webgal-parser`                          | 固定版本的 WebGAL 脚本与样式解析依赖                                                  | 与 inkjs 不同；不执行服务端 Ink，也不是当前交互故事的权威路由                                       |
| `packages/protocol`                      | 严格 Zod schema、类型、轮次身份、请求/事件/回执 DTO；提供 OpenAPI 生成依据            | 不导入前后端；只定义平台能力与有界 ID，具体故事成员由活动故事包再次校验                             |
| Fastify HTTP 层                          | Bearer 鉴权、限额、JSON/multipart 校验、SSE、转录预览、私有媒体访问                   | 不把 Provider 密钥或存储凭证交给前端                                                                |
| SessionManager                           | 会话内存、单有效轮、generation、幂等、超时、已确认历史/事实、冻结回执、Ink checkpoint | 跨轮状态所有者；唯一负责把候选 checkpoint 提交成权威进度的模块                                      |
| LangGraph                                | 单轮输入分流、上下文、规划、结构/动作校验、确认复核、修复、TTS、事件发布与背压等待    | 不负责浏览器演出；当前没有 MemorySaver/数据库式长期记忆，跨轮状态由 SessionManager 持有             |
| ScenarioDefinition / InkScenario / inkjs | 当前合法 choices、阶段、已知内容、导演提示、候选 beat/checkpoint；校验存档父链        | `propose` 在副本中计算，不直接改权威进度；Ink 不调用 LLM，也不渲染页面                              |
| 服务端故事包                             | `.ink`、manifest、角色身份、Lore、作者台词、资源成员、Mock 内容                       | 隐藏信息与剧情条件留在后端；前端仅得到公开投影及当次授权展示正文                                    |
| LLM / GptPlanner                         | 根据当前输入、已确认上下文和合法动作，输出结构化回复、动作意图和发言建议              | 输出是待校验的 `unknown`；不能直接改世界、选择任意资源 URL、变量、Provider 或执行代码               |
| Deepgram STT / TTS                       | STT：规范化 WAV → 转录；TTS：文字 → 音频字节                                          | 两个独立接口；按住录音 REST 与逐句合成，当前不是 WebSocket 全双工语音系统                           |
| MediaService + Local / R2                | 校验并暂存合成音频，分配服务器 ID，检查 session 归属、有效期和容量，负责清理          | R2 是可选的私有音频存储，不是剧情数据库；浏览器经鉴权 API 取音频                                    |
| ConnectionMonitor                        | 独立 GET SSE 心跳、HTTP ping、重连退避、触发同步回执与读取快照                        | 与回复 POST SSE 分开；恢复不会自动重发旧 input 或重播旧音频                                         |

默认 Mock + Local 不需要外部密钥。Live 的 STT 可显式禁用，页面读取 `session.capabilities.voiceInput` 决定是否开放录音；Live 失败不会静默降级到 Mock。本文不读取本地密钥或据此推断当前运行服务的具体模式。

## 4. 普通文字聊天时序

初始化时，页面调用 `POST /api/sessions`，以宿主对应的 entry 获取 sessionToken、voiceInput 能力、场景快照和可选 opening；浏览器恢复初始场景，WebGAL 宿主挂载舞台及所选角色。opening 是文字开场，不伪造声音完成或剧情回执。独立连接监测使用 GET SSE 与 ping，不创建模型任务。

以下为已有会话中的 Live 普通聊天，不含剧情动作；Mock 的调用位置相同，但不会访问外部服务。图中将 ApiClient 合并在 Controller。

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant C as TurnController
    participant API as Fastify API
    participant S as SessionManager
    participant G as LangGraph
    participant I as Scenario / Ink
    participant L as GPT Planner
    participant T as Deepgram TTS
    participant M as MediaService
    participant P as PlaybackScheduler
    participant V as 音频 / 场景 / Live2D
    U->>C: 发送文字或点击建议 draft
    C->>C: 失效旧轮、停止旧播放、冻结旧回执
    C->>API: POST /turns，generation + receipts + frozenTurns
    API->>S: 合并合法回执，begin 新轮
    S-->>C: begun
    C->>API: POST /turns/:turnId/input，text
    API->>S: startInput，身份/幂等/并发检查
    API-->>C: SSE ready
    API->>G: runConversation
    G->>S: 登记本轮用户输入，读取历史/事实
    G->>I: 当前角色、已知 Lore、导演提示、合法 actions
    G->>L: 结构化规划请求
    L-->>G: 待校验回复与 suggestions
    G->>G: Schema + 场景规则校验，失败最多修复一次
    loop 逐句；最多准备当前句和下一句
        G->>T: synthesize(text)
        T-->>G: 音频字节
        G->>M: 校验并存储合成音频
        M-->>G: 服务端生成的私有 audioUrl
        G->>S: 登记 issued segment target
        API-->>C: SSE audio.ready，受控 audioUrl + 文本/情绪/动作
        C->>P: 校验身份/序号后入队
        P->>API: 经 BrowserAudio 鉴权 GET /api/media/:assetId
        API->>M: 校验 session 归属并读取
        M-->>API: 音频二进制
        API-->>P: 音频二进制
        P->>V: 播放声音/字幕/动作，实际音量驱动口型
        V-->>P: 音频 onended
        P->>C: segment presented 回执
        C->>API: POST /receipts
        API->>S: 校验 issued target，提交已完成角色台词
        S-->>G: 回执解除后续句的背压等待
    end
    G->>API: reply.done + suggestions
    API-->>C: SSE reply.done，然后正常结束流
    C->>P: generationDone，仅标记生成结束
    P->>P: 队列与呈现全部结束后展示建议
    Note over G,P: reply.done 可能先于末句播放完成；正常 EOF 不取消有效播放
```

声音失败时，用户可以重试，或改用逐句字幕确认。字幕确认使用 `mode=text` 的 segment 回执；仅把文字放到界面历史里不构成确认。

## 5. 剧情动作时序：移动、读信、照片、环境与结局

自然语言动作需要先经 LLM 识别；菜单等明确的 `interaction` 输入直接进入可信动作分支。两者最后都由当前 Ink choices 约束。

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant C as Controller / API
    participant G as LangGraph
    participant L as GPT Planner
    participant I as InkScenario / inkjs
    participant S as SessionManager
    participant P as PlaybackScheduler
    participant W as 场景适配 / WebGAL / Live2D
    U->>C: 当前轮 input
    C->>G: 合法文字或 interaction
    alt 文字表达动作
        G->>L: plan_reply，含合法 actions 和完整 userText
        L-->>G: actionId + actionRequest + suggestions
        G->>G: 完整 quote、confirmed、当前动作集合校验
        opt explicit 动作
            G->>L: confirm_action，独立复核同一动作
            L-->>G: 确认或澄清
        end
        Note over G,L: 只有确认通过才走后续动作；否则转澄清/普通回复或受控失败
    else 结构化菜单操作
        G->>G: 使用 actionId + revision，无需为意图调用 LLM
    end
    G->>I: propose(action, 已确认 checkpoint)
    I->>I: 独立解释器副本运行，校验 choices/资源/版本
    I-->>G: 有序 beats + 每 beat 候选 checkpoint
    loop 每个 beat
        opt 有作者台词
            G->>G: TTS → MediaService → issue segment
            G-->>C: SSE audio.ready
            C->>P: 入队
            P->>W: 按统一时序播放台词和角色状态
            W-->>P: 台词结束
            P->>C: segment 回执
            C->>S: 确认台词
        end
        G->>S: issueEvents，记录依赖和候选 checkpoint
        G-->>C: presentation.ready，事件 + storyAfter/factsAfter
        C->>P: 视觉事件入队
        P->>W: 展示正文/照片，移动/改变环境/结局
        W-->>P: 实际呈现完成或失败
        P->>C: 对应 event 的独立回执
        C->>S: POST /receipts
        S->>S: 校验依赖、冻结范围、顺序、revision 与父存档链
        S->>I: 成功时 accept(current, candidate)
        I-->>S: 合法下一 checkpoint
        S->>S: 提交 narrative/story/facts
        S-->>G: 唤醒等待；成功后继续下一 beat
    end
    G-->>C: reply.done
    C->>P: generationDone
    Note over I,S: propose 只产生候选；SessionManager 才能提交权威剧情进度
    Note over P,W: 照片成功不能代替正文/环境/地点/结局等其他回执
```

图中成功路径才会调用 `accept`；失败回执不提交对应 checkpoint，前置呈现失败会阻止后续 beat。当前 beat 的台词与视觉可以先后入队，服务端在继续下一 beat 前等待前一个呈现锚点回执。

纯剧情操作不会为了产生建议额外调用 LLM，作者台词仍按需要调用 TTS；自然语言的 explicit 复核会增加一次 planner 调用。普通聊天通常一次规划，结构修复最多一次，不能把所有交互概括为固定一次 LLM 请求。

## 6. 语音输入时序：先预览，再确认发送

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant C as TurnController / Recorder
    participant API as Fastify API
    participant S as SessionManager
    participant F as FFmpeg 规范化
    participant D as Deepgram STT
    U->>C: 按住录音，松开结束
    C->>API: begin 预览轮 + POST /transcription，multipart 录音
    API->>S: 校验身份、上传、能力、并发
    API->>F: 受限解码，16kHz 单声道，验证实际时长
    F-->>API: 规范化 WAV
    API->>D: transcribe(WAV)
    D-->>API: text
    API->>S: 结束预览任务，释放处理占用
    API-->>C: JSON 草稿 text + simulated + TurnIdentity
    C-->>U: 可编辑语音草稿
    Note over API,D: 此阶段无 LLM/TTS、无回复 SSE、不写用户对话历史或剧情事实
    U->>C: 编辑并明确确认
    C->>API: 新 begin + 文字 input，提交最终文字
    Note over C,API: 后续接普通文字聊天/动作流程，不再次 STT
```

兼容协议仍支持直接向 `/input` 上传 audio：在回复 Graph 内先 `transcribe` 再规划。当前两个页面使用上面的预览确认流程。Deepgram HTTP 200 的空转录会映射为预览接口的 `422 / NO_SPEECH`，不制造假转录，也不将其视为会话失效。

## 7. 打断、取消与新轮时序

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant C as TurnController / ReceiptBook
    participant P as PlaybackScheduler
    participant API as Fastify API
    participant S as SessionManager
    participant Old as 旧 Graph / Provider / 异步资源
    U->>C: 新输入、开始录音或主动打断
    C->>C: 同步使旧 current 失效，abort 旧请求
    C->>P: cancel，停止声音、字幕、瞬时演出、旧建议
    C->>C: 冻结旧轮累计回执
    C->>API: 尽力 POST 旧 turn/cancel，附冻结回执
    API->>S: 合并合法回执、冻结并取消该旧轮
    S->>Old: AbortSignal，清理旧任务与私有媒体
    opt 新输入继续
        C->>API: begin 新 generation，携带 outbox + frozenTurns
        API->>S: 新上下文构造前，原子校验并合并回执
        S->>S: 只保留已确认前缀，创建新轮
        S-->>C: begun
        C->>API: 提交新 input
    end
    Old-->>C: 迟到网络响应或播放/资源回调
    C->>C: 身份不匹配，丢弃
    Note over S,Old: 服务端每阶段 await 前后检查当前轮；旧 cancel/finally 不得影响新轮
```

轮次身份为 `sessionId + turnId + generation`；网络事件还校验版本、eventId、连续 seq。剧情动作另有 `revision` 和 checkpoint 父 hash。舞台与模型加载还有独立生命周期 owner/epoch，避免旧舞台回调覆盖重建后的舞台。

## 8. LangGraph 的实际节点

```mermaid
flowchart TD
    Start([START]) --> Normalize[normalize_input]
    Normalize -->|text| Context[build_context]
    Normalize -->|兼容直接 audio| Transcribe[transcribe]
    Transcribe --> Context
    Normalize -->|结构化 interaction| Story[story_interaction]
    Context --> Plan[plan_reply]
    Plan --> Validate[validate_plan]
    Validate -->|普通回复合法| Synthesize[synthesize_and_publish]
    Validate -->|动作合法且非 explicit| Story
    Validate -->|动作合法且 explicit| Confirm[confirm_action]
    Confirm -->|同一动作通过| Story
    Confirm -->|未通过：禁用动作后再校验| Validate
    Validate -->|非法且仍可修复| Repair[repair_plan，最多一次]
    Repair --> Validate
    Validate -->|修复额度耗尽| Failure[受控失败]
    Story --> End([END])
    Synthesize --> End
```

`story_interaction` 内部展开 Ink beats、按需合成作者台词、发布视觉事件并等待回执；`synthesize_and_publish` 内部逐句合成、暂存媒体、发布 `audio.ready`，用回执限制预生成数量。语音草稿预览复用 `graphs/transcription.ts` 的函数，不调用这个回复 StateGraph。

## 9. 内容构建与数据归属

`scenarios:build` 将服务端场景 `.ink` 与校验后的 JSON 编译为服务端 `compiled.json`，并生成前端 `manifest.generated.json`。后者只含公开呈现字段和资源引用；不含 Ink 字节码、私有 Lore、作者语音台词、私有标记或存档。前后端通过场景 `id/version` 检查匹配。

| 数据                                   | 权威来源/持有者                                          | 前端得到什么                                     |
| -------------------------------------- | -------------------------------------------------------- | ------------------------------------------------ |
| 场景规则、角色身份、隐藏内容、合法动作 | 服务端故事包与 Ink 当前 checkpoint                       | 当前可公开动作/状态，当次已授权的文档正文        |
| 跨轮历史与已确认剧情事实               | SessionManager 的有界内存                                | 会话快照及事件中的公开投影                       |
| LLM 回复、动作意图、建议               | Planner 候选，经 Graph/场景校验                          | 合法回复事件与 label/draft；建议不等于已执行动作 |
| 声音是否播放完、视觉是否完成           | Scheduler 基于浏览器播放/呈现结果生成回执                | 本地完成状态；后端再做归属、依赖和冻结校验       |
| 场景资源和模型路径                     | 前端场景包、profiles、受控本地资源清单                   | 本地 URL；不能由模型任意指定                     |
| 合成音频                               | MediaService + Local/R2 私有存储                         | 后端签发的 `/api/media/:assetId`，请求仍需鉴权   |
| API/Provider 凭证                      | 后端配置；短期 sessionToken 在浏览器隔离保存，见 ADR 013 | 页面仅有短期 sessionToken 与实际能力标志         |

目前会话/存档是单进程内存，不是数据库持久化；重启需要新会话。R2 存音频不会使剧情存档自动持久化。连接恢复先同步未确认回执，再取快照，不自动重放输入或演出。

## 10. 源码定位

| 看什么                 | 文件                                                                                                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 两个入口选择场景       | [Vue main](../../apps/web/src/app/main.ts)、[WebGAL main](../../apps/web/src/webgal/main.tsx)                                                                                                                    |
| WebGAL 组合与生命周期  | [InteractiveHost](../../apps/web/src/webgal/product/host.ts)、[engine-adapter](../../apps/web/src/webgal/runtime/engine-adapter.ts)                                                                              |
| 原生故事执行门禁       | [runtimeMode](../../apps/web/src/engine/webgal/host/runtimeMode.ts)、[runScript](../../apps/web/src/engine/webgal/Core/controller/gamePlay/runScript.ts)                                                         |
| 前端轮次和回执         | [turn-controller](../../apps/web/src/interaction/turn-controller.ts)、[receipts](../../apps/web/src/interaction/receipts.ts)                                                                                     |
| 播放与呈现接口         | [scheduler](../../apps/web/src/playback/scheduler.ts)、[audio](../../apps/web/src/playback/audio.ts)                                                                                                             |
| WebGAL 场景与角色适配  | [CafePresentation](../../apps/web/src/webgal/scenes/cafe/presentation.ts)、[CharacterDriver](../../apps/web/src/webgal/characters/driver.ts)、[profiles](../../apps/web/src/webgal/characters/profiles/index.ts) |
| Vue 角色适配           | [CharacterStage](../../apps/web/src/scene/CharacterStage.vue)、[live2d](../../apps/web/src/scene/live2d.ts)                                                                                                      |
| 协议定义               | [protocol/index](../../packages/protocol/src/index.ts)、[protocol/story](../../packages/protocol/src/story.ts)                                                                                                   |
| HTTP 与 SSE            | [app](../../apps/server/src/app.ts)、[sse](../../apps/server/src/http/sse.ts)                                                                                                                                    |
| 会话和 checkpoint 提交 | [SessionManager](../../apps/server/src/sessions/manager.ts)                                                                                                                                                      |
| Graph 和转录函数       | [conversation](../../apps/server/src/graphs/conversation.ts)、[transcription](../../apps/server/src/graphs/transcription.ts)                                                                                     |
| 场景端口和 Ink 适配    | [ports](../../apps/server/src/scenario/ports.ts)、[InkScenario](../../apps/server/src/scenario/runtime/ink.ts)                                                                                                   |
| 故事内容和上下文       | [cafe](../../apps/server/src/scenario/cafe/index.ts)、[context](../../apps/server/src/scenario/runtime/context.ts)                                                                                               |
| Provider 接口和装配    | [types](../../apps/server/src/providers/types.ts)、[factory](../../apps/server/src/providers/index.ts)                                                                                                           |
| GPT 与 Deepgram        | [planner](../../apps/server/src/providers/openai/planner.ts)、[stt](../../apps/server/src/providers/deepgram/stt.ts)、[tts](../../apps/server/src/providers/deepgram/tts.ts)                                     |
| 私有媒体               | [MediaService](../../apps/server/src/media/index.ts)、[stores](../../apps/server/src/media/store.ts)                                                                                                             |
| 场景编译               | [compile-scenario](../../scripts/compile-scenario.ts)                                                                                                                                                            |

图中省略了 HTTP 限流、日志、超时和资源释放的内部调用细节；这些机制仍由相应模块实现。本文为源码层面的架构快照，不声明真实供应商、麦克风、视觉或连续多轮交互已经重新验收。
