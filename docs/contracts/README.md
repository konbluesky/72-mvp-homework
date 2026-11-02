# 网络契约

协议唯一来源：`packages/protocol/src/index.ts`。HTTP 路由元数据和 Zod schemas 生成 [OpenAPI](openapi.json)，`npm run contracts:generate` 更新，`npm run contracts:check` 检查一致性并由 Swagger Parser 验证。

## 会话与输入

1. `POST /api/sessions` 返回 sessionToken、expiresAt 与 capabilities.voiceInput。`expiresAt: null` 表示不按时间过期（默认）；正整数表示 Unix 毫秒到期时间，可用 `SESSION_TTL_SECONDS` 正值显式开启。浏览器按 API origin、入口和故事包隔离保存会话凭证，用于刷新恢复；过期或鉴权失效清除凭证，按实际能力开放录音，不由 Mock/Live 字符串推断。凭证方案见 [ADR 013](../architecture/decisions.md#adr-013--浏览器侧保存与短期会话恢复)，保留策略见 [ADR 014](../architecture/decisions.md#adr-014--默认保留会话显式重新开始才替换)。
2. 对该会话所有操作用 `Authorization: Bearer <sessionToken>`；私有媒体另带 `X-Session-Id`。令牌不放 URL。
3. `POST /api/sessions/:id/turns` 提交 `{turnId,generation,receipts,frozenTurns}`。generation 是会话内单调正整数，同代同ID幂等，同代不同ID冲突，旧代拒绝。
4. 等 begin 确认后 `POST .../:turnId/input`。文字：`{generation,inputId,text}`。录音：multipart 中 `metadata` 是 `{generation,inputId,durationMs}` JSON，`audio` 是真实 MIME 的文件，客户端不得只修改扩展名。
5. 同轮同 inputId 和摘要不会二次调用 Provider：进行中 `INPUT_IN_PROGRESS`，已完成 `INPUT_COMPLETED`，已取消 `TURN_CANCELLED`。不同内容或不同 inputId 重用已提交轮次返回 `INPUT_CONFLICT`。这些都是 409，无自动旧音频重放。

用户明确重新开始时，创建请求可携带 `{entry, replaceSessionId}`，并用旧会话的 `Authorization: Bearer` 鉴权。服务端先准备新会话，成功后同步取消并移除旧会话；满额时可复用自己的旧名额，不清理其他人的会话。错误凭证返回 401，旧会话不变；旧会话已不存在/过期时允许创建新会话。普通连接恢复只 GET 快照，不携带替换指令。明确重开后的网络失败保留替换意图与凭证，连接恢复或页面刷新可继续该创建操作，不发送玩家输入。本次 HTTP 字段扩展需前后端协调更新。

## SSE

fetch POST 读取 ReadableStream。每个帧 `data: <JSON>\n\n`，心跳 `: heartbeat\n\n`。UTF-8、CRLF、跨chunk、多行data由同一 parser 处理；不完整尾帧、未知版本、序号缺口或身份不匹配受控中止。相同eventId/相同内容可忽略，冲突内容拒绝。

统一字段：schemaVersion=2、sessionId、generation、turnId、eventId、seq（从1连续递增）、type、payload。

| type              | 语义                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| ready             | 连接已准备好；payload.streamId为服务端生成；remainingLifetimeMs为剩余呈现预算，客户端提前1秒冻结/取消 |
| input.transcribed | 转录结果；Mock明确simulated=true                                                                      |
| audio.ready       | segmentId、text、audioUrl、emotion、action、events；音频单独鉴权下载                                  |
| reply.done        | **生成完成**，有效播放仍可继续；不代表用户已听完                                                      |
| error             | 稳定code/message/retryable；流开始后不用第二次HTTP JSON响应                                           |

SSE正常完成不会中断有效播放。异常断线取消该stream拥有的任务；重新连接只查询快照或开始新轮，不重播事件。

## 实际呈现与回执

`POST .../receipts` 接收 `{receipts}`，返回 `acknowledged` receiptId列表。Receipt含完整TurnIdentity以及receiptId、targetId、kind（segment/photo/environment）、status（presented/failed），句子可带mode=audio/text。

- 音频播放完毕提交 segment presented；被打断半句不提交完成。
- 字幕降级由用户逐句确认，标为mode=text，不声称播放声音。
- 照片解码且真正显示后提交 photo presented，对应 `photo_revealed`。
- 环境变化独立确认，对应 `rain_softened`。
- 仅接收确实发给本会话的事件/片段，客户端不能直接写事实。
- 本地取消冻结快照，下一begin先合并累计回执再构造上下文；重复/乱序不能撤回事实或扩充已冻结结果。

`POST .../:turnId/cancel` 接收 `{generation,receipts,frozen:true}`，只作用于指定轮。完整schema与limits见协议源码；不要另写与代码不同的字段表。

## 失败

消息级重试使用可选的 `begin.messageId`：同一用户消息在重试时保留该 ID，但使用新的 turnId、generation 和 inputId；同一执行内的输入幂等规则保持不变。服务端拒绝更改重试内容、重试已经有成功呈现回执的消息，以及在后续新消息之后重试旧消息。原位重试前客户端先同步冻结回执并查询快照，不自动重放输入。

会话快照新增有界的可选 `messageAttempts`，返回消息对应执行的 pending/completed/failed/interrupted、presented、retryable 和安全错误文字。此处 completed 要求生成结束且所有下发目标均成功呈现；原有 begin 响应中的 completed 仍仅表示生成结束。用户输入在 Graph 中暂存，首次成功呈现回执才与已呈现回应一起写入历史；完全未呈现的失败输入不会重复进入后续模型上下文。部分回复与已确认剧情保留，不整轮重放。浏览器记录已经开始显示但未完成的回复，亦禁止直接重试。

非流错误统一 `{error:{code,message,retryable},requestId}`。400非法数据；401无效令牌；409身份/幂等冲突；410会话失效；413上传过大；415格式不支持；422/NO_SPEECH表示没有识别出语音，当前会话仍可用于文字；429限流；502/504外部服务失败或超时；503容量不足。详情以生成OpenAPI与schema为准。

会话创建和快照现在都包含必填 `capabilities: { voiceInput: boolean }`。该新增字段由实际Provider组合生成，不携带供应商凭证。发布时先更新后端再更新前端；旧前端会忽略新增字段，新前端需要该能力字段。

## 用户发言推荐

`ReplyPlan` 现在必须包含 `suggestions`，由 planner 与 `segments` 同次生成。建议2–3个不同方向，必要时允许空数组；最多3项，每项严格为 `{ label, draft, interaction? }`（文字分别最多20、120字符）。它是用户下一条自然发言候选，不参与TTS，也不直接写入会话历史或剧情事实。

现有 `reply.done.payload` 同时返回 `{ segmentCount, suggestions }`，不新增推荐HTTP接口或第二次常规LLM调用。客户端校验轮次后暂存，全部播放/呈现完成才显示；取消、新轮或过期立即清除，视觉失败不显示。闲聊候选走正常文字 begin/input 链路；服务端故事包编写的明确行动候选可绑定带 revision 的 interaction，用户点击后走已有 interaction 分支，服务端再次检查当前合法动作。模型输出 schema 不包含 interaction，模型关联动作仅能换成故事包编写的候选后获得此绑定。Vue 先填入编辑，仅在文字未改且动作/版本仍匹配时保留绑定，否则按普通文字输入判断。生成候选不执行动作、不提交事实；所有剧情仍由呈现回执确认。严格旧客户端需与后端同时更新并刷新。`suggestions` 在SSE接收schema中为可选，兼容旧服务端缺失时不展示候选；当前服务端始终发送该字段。部署时先更新服务端planner/schema，再更新前端。

## 语音草稿预览与确认

当前页面的录音流程是 begin → `POST /api/sessions/:id/turns/:turnId/transcription`（multipart metadata/audio）→ 可编辑草稿 → 用户确认 → 新begin → 文字input。预览响应为完整TurnIdentity加 `{ text, simulated }`，共享 `TranscriptionPreviewSchema` 校验；支持与其他轮次相同的鉴权、上传、取消、限流和处理并发保护。

预览只运行录音校验与所选STT，不写用户history，不调用GPT/TTS，不发SSE或媒体。识别完释放任务，用户编辑无需持有活动模型请求。确认提交的是最终编辑文字，不再次识别录音。`input`仍兼容原audio multipart链路，但页面不会用它直接发送未确认录音。

## 无状态连接监测

`GET /api/connection/events`为公开、无敏感信息的常驻SSE，不创建会话、不占用模型任务。`ConnectionEventSchema`严格校验schemaVersion、type（connection.ready/connection.heartbeat）、connectionId、连续seq、status与5秒heartbeatIntervalMs。新的连接从ready/seq=1开始，不回放旧事件；它与带TurnIdentity的回复流是两个独立用途。

`GET /api/connection/ping`使用strict `ConnectionProbeSchema` 返回 `{schemaVersion:1,status:"ok"}`，用于浏览器本地单调时钟的HTTP往返采样，无令牌和cookie。正常JSON请求有总deadline，POST回复流仍使用自身读取/轮次预算。

更多恢复与状态语义见[运维说明](../operations/connection-health.md)。监测重连不自动重试带输入的POST，不创建已过期会话，不伪造呈现回执。

## 未识别出语音

Deepgram成功返回HTTP 200但transcript为空时，Provider保留NO_SPEECH分类，HTTP边界返回422与稳定的NO_SPEECH错误码（retryable=true只表示用户可以重试，不触发自动重录/识别）。它不是连接或会话失效；客户端结束失败的预览轮次，展示“重新录音/改用文字”，不创建假转录、不调用Planner/TTS、不要求重新连接。格式错误、超限等预览错误也保持在语音输入区域处理；认证/会话过期与传输失败仍走原恢复流程。

## 八场景故事契约（v2）

默认产品新增 strict 的 interaction 输入：move/location、inspect/prop、choose/ending；未知地点、任意脚本、路径与额外字段拒绝。纯导航经 Graph 确定性分支生成 presentation.ready，不伪造音频；reply.done 仍只表示生成结束。

location、prop、ambience、ending 均有独立 issued target 与回执。场景组合事件依赖前置语音/视觉的成功回执；当前位置按服务端事件顺序更新，迟到冻结回执不倒退新地点。照片仍用独立 photo 回执，雨势改由合法离店节点提出，不再以看过照片为前置。快照新增 story 的地点、已公开道具、灯光/营业状态与结局。

完整严格定义见协议源码与生成 OpenAPI。v1 严格客户端需协调升级并刷新；照片/声音完成不能替代新场景目标完成。

## Ink场景与呈现checkpoint（schemaVersion 3）

创建会话支持可选JSON `{entry:"story"|"conversation"}`，缺省story。WebGAL故事从大堂的初次相遇开始；原版对话使用conversation的窗边初始设定，同一Ink包按宿主能力提供choices。`scene.story`新增phase、revision、milestones、actions；动作有id/label/kind/explicit/description，不包含Ink路径、源码或存档。

`interaction`新增 `{kind:"action",actionId,revision}`。服务端按当前存档与版本验证选择；菜单中的地点和既有物件快捷操作使用该结构；WebGAL 推荐与手写发言使用文字 input。旧move/inspect/choose输入仍按当前合法集合解释，不支持客户端直接改变量。

`presentation.ready`可附`storyAfter/factsAfter`，供客户端在该片段实际呈现后投影；它们不是浏览器上报的事实。事件新增`beat`呈现锚点；prop事件可携带服务端授权的document.title/text，前端用同源正文呈现。对应回执kind支持location/prop/ambience/ending/beat。服务器根据已下发目标、前置回执、冻结范围、revision与父存档hash提交候选checkpoint，不接受客户端提交Ink状态。

模型使用私有`PlannerOutputSchema`，包含 actionId、actionRequest（完整当前 userText 引用与 confirmed）以及带 kind/relatedActionId 的候选元数据。Graph校验后转换为普通ReplyPlan或可信Ink演出。公开推荐仍只有label/draft；元数据不变成自动执行指令。普通模型segments不得创建世界事件，递照片等世界动作也走合法Ink选择。

当前正常LLM调用同时解释输入并生成推荐。自然语言明确请求当前合法动作时可以附带不假定未来结果的闲聊候选；所有演出完成才展示。纯地图/热区操作不为推荐额外调用LLM，必要的作者台词继续走现有TTS。

## 会话动作确认（2026-11-01）

explicit 代表需要明确意图/同意，不限制输入表面。Graph 要求 actionRequest.quote 等于完整当前文字、confirmed=true，并校验当前允许动作、revision 与轮次身份。explicit 动作额外经过 Graph 内独立确认复核，同一动作通过后才执行；拒绝、假设、询问后果与含糊附和转为角色澄清。复核不是推荐接口，普通聊天与普通动作仍在同次规划中生成建议。模型不输出可信资源地址，Ink 事件和实际呈现回执仍决定事实。

SessionCreated 可选 opening 为故事包提供的 {text,revision,suggestions}；只用于本次会话的初始文字与自然回复，不记作声音完成或事实。开场候选在第一次发言或 revision 变化后失效。

## 场景模块ID与公开投影

创建会话支持可选的 `expectedScenario: {id,version}`。两个前端入口始终传入所装配的模块身份；服务端在分配容量或替换旧会话前比较当前故事身份，不一致返回 HTTP 409 / `SCENE_MODULE_VERSION_MISMATCH`，不创建新会话、不删除原会话。客户端仍校验创建响应与恢复快照；版本不一致单独显示“刷新页面”，保留恢复凭证、草稿和回看，不触发重新开始或自动重复创建。

地点、道具、结局、阶段、角色、环境预设与公开事实不再由共享协议枚举咖啡馆内容。共享层校验有界ID、DTO与数量；活动故事包在编译及Ink适配时进一步校验已声明的地点、道具、结局和资源。不能因为ID格式正确就执行未注册内容，也不接收任意URL或代码。

场景快照可附带 `scenario: {id,version}`，当前服务端始终提供，用于前端与所装配模块匹配。`presentation.ready.payload.environmentAfter`由服务端故事投影提供；Scheduler不再从具体的照片/雨势事实推导环境，只在实际呈现成功后投影随事件返回的状态。

标准photo/environment事件与四态、表演动作保留兼容；它们的资源、事实和呈现实现由故事包解释。生产的隐藏Lore和Ink存档不进入公开呈现manifest。

## 图片分享与字幕（schemaVersion 4）

`image.pending` 包含 share 投影、独立 slotEventId 与无世界事件的 introduction；`image.ready` 包含 shareId/version、imageEventId、私有 assetId 与 introduction。它们分别产生 `image-slot` 和 `image` 回执。`text.ready` 明确表达无音频的字幕演出，普通 `audio.ready` 仍强制鉴权 audioUrl；引出台词为两者的受限联合。音频/字幕、占位和图片的成功不能相互替代。

SessionSnapshot 增加已宣布 imageShares（最多一项），不含提示词或供应商 ID。GET `/api/sessions/:id/image-shares/:shareId`、POST 同路径 `/cancel` 与 `/retry` 均要求会话鉴权；retry 带 requestId/expectedVersion。没有通用创建生图接口。未呈现 ready 不公开 assetId；已确认历史可通过受鉴权媒体恢复缩略图。

begin 可带 `mediaPresentation:{purpose:'media-share',expectedGeneration,shareId,expectedShareVersion}`，成功返回 claimId。input 使用 `media:{kind:'image-share',shareId,claimId}`；不伪造 user text 或 actionId。过时申请返回冲突并安静暂缓，不取消当前新用户轮。新的展示继续复用单轮 SSE，绝不向 reply.done 后的旧流追加事件。
