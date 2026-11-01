# Provider、配置与验证边界

更新：2026-10-31。实现以 [`config/index.ts`](../apps/server/src/config/index.ts) 为准。日常配置使用 [最小后端模板](../.env.example) / [前端模板](../.env.frontend.example)；部署、R2 和预算调整见 [高级配置](../.env.advanced.example)。

## 最短配置步骤

默认 Mock + Local 不需要密钥。前端 `apps/web/.env.local` 保持 `VITE_API_BASE_URL=""`，开发时通过 Vite 代理访问后端。

真实「文字输入 + 角色语音回复」只编辑 `apps/server/.env`。已有文件保留原值，填写下列五项并设置 `APP_MODE=live`，再重启后端：

| 服务         | 配置项                                     | 内容                                                                 |
| ------------ | ------------------------------------------ | -------------------------------------------------------------------- |
| GPT Provider | `GPT_BASE_URL`、`GPT_API_KEY`、`GPT_MODEL` | API 根地址、密钥、精确模型 ID；地址不含完整 completion/response 路径 |
| Deepgram TTS | `DEEPGRAM_API_KEY`、`DEEPGRAM_MODEL`       | 官方 API key、账户有权限的中文 `flux-*-zh` 音色                      |

GPT 默认 Chat Completions + JSON Schema，确有兼容性需要时才配置 `GPT_API_STYLE` / `GPT_STRUCTURED_OUTPUT`。音色按账户权限选择，示例名不代表已授权。真实值只写后端本地配置或部署 secret，不写前端、聊天或测试报告。普通测试只使用 Mock/受控接口，不请求付费服务。

## Deepgram 完整语音链路

Live页面语音输入经过真实MediaRecorder → 有界上传/FFmpeg规范化 → Deepgram STT → 可编辑预览 → 用户确认发送 → LangGraph内GPT规划 → Deepgram TTS → 私有媒体下载/实际播放/回执。预览不调用GPT/TTS，也不写会话历史；确认后仅提交编辑后的文字，不重复识别。文字输入跳过采集与识别，其余共用。统一使用 `DEEPGRAM_API_KEY`，不需要第二套云识别账户或token。

- STT：`POST /v1/listen?model=nova-3&language=zh-CN&smart_format=true`，Token鉴权，正文是实际WAV二进制（不是URL或Base64 JSON）。检查HTTP、JSON、metadata和唯一声道的首候选转录。空白结果返回未听清，不生成虚假用户消息，不调用GPT/TTS。
- TTS：继续用既有 `DEEPGRAM_MODEL` 指定的中文Flux音色，`POST /v2/speak` 返回MP3。该字段只控制合成，不拿来选择识别模型。
- `DEEPGRAM_STT_MODEL` 默认nova-3、`DEEPGRAM_STT_LANGUAGE` 默认zh-CN；两项可覆盖但不自动换模型。Nova-3中文支持来自本轮实际核对的[官方模型语言表](https://developers.deepgram.com/docs/models-languages-overview)。
- STT与TTS分别使用 `STT_TIMEOUT_MS`（默认8s）与 `TTS_TIMEOUT_MS`（默认10s）。二者同时受轮次AbortSignal与预算约束，无隐式HTTP重试。
- `STT_PROVIDER=disabled` 是显式的文字模式；会话与快照返回 `capabilities.voiceInput=false`，页面据此禁用录音。默认deepgram；Mock中则提供模拟适配，不因APP_MODE字符串猜测真实能力。

当前沿用按住录音、松开上传与逐句回复，采用预录音频REST和已知整句文本REST。未实现WebSocket流式识别、VAD或全双工对话，也不把完整链路称为逐字流式语音。

官方依据（本轮实际读取）：[识别REST](https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded)、[本地音频上传](https://developers.deepgram.com/docs/pre-recorded-audio)、[Nova-3语言表](https://developers.deepgram.com/docs/models-languages-overview)、[Flux批量合成](https://developers.deepgram.com/docs/flux-tts/batch)。

## 配置位置与模式

后端入口只加载 `apps/server/.env`，进程环境变量优先。前端只配置公开的 `VITE_API_BASE_URL`。`.env.example`、`.env.frontend.example`、`.env.advanced.example` 是模板，`.env.before-setup` 是备份，均不会被应用自动加载。高级参数有代码默认值，按需选择性加入实际后端文件，不整体覆盖现有凭证。

Compose 演示当前固定 `APP_MODE=mock`，未注入后端 env；本地文件不会自动传入容器。Docker 启用 Live 需显式配置 `env_file` 并修改 `environment.APP_MODE`，后者优先级更高。

默认 Local 私有媒体无需存储凭证；若选 R2，Mock 也必须提供完整 R2 配置。会话、媒体、上传与任务限额以及取消保护继续有效，由各Provider共用。

## GPT 适配与编排

`@langchain/openai` 1.8.0 / `@langchain/core` 1.3.2 的 `ChatOpenAI` 仅在 LangGraph 节点调用。包含一次正常规划与最多一次结构修复，`GPT_MAX_RETRIES=0` 默认，避免叠加重试计费。

| `GPT_API_STYLE`  | `GPT_STRUCTURED_OUTPUT`                  | 状态                               |
| ---------------- | ---------------------------------------- | ---------------------------------- |
| chat_completions | json_schema、json_mode、function_calling | 均有注入 fetch 的请求/响应契约测试 |
| responses        | json_schema、function_calling            | 均有受控契约测试                   |
| responses        | json_mode                                | 配置明确拒绝，未启用该组合         |

方法分别映射 LangChain `jsonSchema/jsonMode/functionCalling`。共享 Zod PlannerOutput 生成 JSON Schema；`json_mode` 会把该 Schema 和只输出严格 JSON 的要求附加到 system prompt，避免仅给模型一个没有定义的 ReplyPlan 名称。返回值仍由 Graph 执行运行时与剧情校验，不将 JSON mode 当作严格结构保证；额外字段也会拒绝并进入受限修复。SDK structured parser 使用 includeRaw 的受控结果，解析失败传回 Graph 校验/一次修复，原始模型响应不暴露浏览器。用户模型名和 base URL 保持原样，不默认发送 temperature/reasoning。`GPT_EXTRA_BODY_JSON` 只允许显式数字 `temperature` 与 `top_p`，`GPT_HEADERS_JSON` 只允许字符串 `X-*` 头；不能覆盖鉴权、模型、消息、工具或输出协议。模型能力和用户兼容端点是否真正支持所选组合仍需 Live 验证。

官方依据（本轮实际读取）：[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)、[LangChain ChatOpenAI](https://docs.langchain.com/oss/javascript/integrations/chat/openai)。不使用自动选择模型或未验证的专有参数。

## 录音校验

浏览器采集与上传使用真实 MIME。服务端由受限 FFmpeg 解码到 16 kHz、单声道、16-bit PCM WAV，按实际样本数校验 15 秒（250 ms 编码尾部容差），不信任客户端时长或容器摘要。之后交给所选识别器；Mock明确标注模拟转录，Deepgram返回simulated=false。

解码器使用可信管理员配置的 `FFMPEG_PATH`（默认 `ffmpeg`）；无 shell，禁网络/文件协议，限制格式、2 个并发、5 秒墙钟、4 KiB stderr 与约 488 KiB PCM 输出；超限或取消即停止子进程。文字与不支持录音的 Live 路径不会启动解码器。测试使用真实 FFmpeg 验证 WAV/WebM/Ogg/MP4/MP3、超长、取消及缺工具。

## 识别为空时的排查

`HTTP 200 + NO_SPEECH`表示请求和响应契约成功，但没有识别文本，不等于GPT、TTS或整台服务掉线。HTTP入口现在返回422/NO_SPEECH，页面允许直接重录或切换文字，保留当前会话。

浏览器松开后等待MediaRecorder最终dataavailable/stop再关闭tracks，最多2秒收尾；取消/隐藏仍立即释放。录音日志包含解码时长、字节数、采样率及audioSignal摘要（rmsDbfs、peakDbfs、silent），Deepgram配置日志增加language。完全静音的dB值用null表示，不打印PCM、波形、转录、设备ID或凭证。摘要只辅助区分静音/弱输入与有信号但无识别，不能充当准确VAD或语音质量验收。

可先用离线capabilities确认model/language。Nova-3与zh-CN组合已按[官方模型语言表](https://developers.deepgram.com/docs/models-languages-overview)核查支持；不因一条NO_SPEECH擅自切模型、Mock或自动重试付费请求。若新录音继续失败，结合该轮recording摘要与provider request ID定位；本轮没有重放用户录音或调用真实识别服务验收。

## Deepgram 官方 TTS

实际读取 [Flux batch REST](https://developers.deepgram.com/docs/flux-tts/batch)、[quickstart](https://developers.deepgram.com/docs/flux-tts/quickstart)、[音色表](https://developers.deepgram.com/docs/flux-tts/voices)。当前官方文档确实列有中文 `flux-lijuan-zh`，标注 Early Access；这只证明文档存在，不证明用户账户拥有权限或听感符合要求。模板因此不预选音色。

`POST https://api.deepgram.com/v2/speak?model=<configured>&encoding=mp3`，`Authorization: Token ...`，JSON `{text: "该句与字幕同源的文本"}`。本 MVP 逐句完整 REST 合成，未使用 WebSocket Flush/Interrupt。检查 HTTP 状态、`audio/mpeg`、MP3 签名、非空与流式体积上限。错误 JSON 即使伪装 content-type 也不能发布为音频。v1/Aura 组合未开放，不偷偷换服务或语言。

## Local/R2 媒体

`MediaService` 的 catalog 记录随机 asset ID、session/turn 归属、MIME、过期时间和字节数；浏览器只能通过鉴权的 `/api/media/:assetId` 获取媒体，无法提交磁盘路径。默认 4 MiB/音频，64 MiB/catalog，全局容量在异步存储前同步预占。取消时未发布对象删除，TTL sweep 删除过期项，close 清理本进程对象。

R2 用 AWS SDK v3 S3 的 Put/Get/Delete；`R2_ENDPOINT` 必须为账户 HTTPS S3 endpoint，`region=auto`、私有 `R2_BUCKET`、独立 S3 access key/secret。所有对象在 `private-audio/`，不设置 public ACL。官方依据：[R2 AWS SDK v3](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)。浏览器不持有 R2 凭证；`MEDIA_DELIVERY` 仅支持 api_proxy。

会话与媒体 catalog 是单进程内存，重启后旧凭证失效，不恢复播放。Local 启动清理前进程 UUID 孤儿文件，运行期间按 TTL 清理。R2 必须额外设置 bucket lifecycle 清理崩溃留下的孤儿对象；业务请求仍以 catalog TTL 为准，不能依赖 lifecycle 延迟作为鉴权。重启后 R2 孤儿的总量上限依赖 lifecycle 与运维预算，不能宣称无限次重启仍由内存计数约束存储总量。

## 超时与验收

Provider 超时（GPT 12s、STT 8s、TTS 10s）与首音频 20s、后续等待 20s、整轮 120s 分开配置。首段发布后解除首音频预算；整轮持续覆盖生成与呈现等待。这些是故障预算，不是 P50/P95 或体验目标。AbortSignal 贯穿图与 SDK/fetch/存储；上游忽略取消时丢弃迟到结果，无法撤销已经产生的费用。

受控测试位于 [`providers.test.ts`](../apps/server/src/providers/providers.test.ts)、[`media.test.ts`](../apps/server/src/media/media.test.ts)、[`config.test.ts`](../apps/server/src/config/config.test.ts)。测试请求使用注入 fetch/S3 mock，不向付费服务发送请求。运行结果和完整证据以 [验收目录](acceptance/) 为准。

待验证项和本轮实测结果见[Deepgram验收记录](acceptance/deepgram-integration.md)。真实GPT端点/模型能力、中文识别质量、Deepgram听感、R2 私有 bucket 与实际取消、正式 HTTPS/CORS/SSE 代理及移动真机。本轮只执行明确记录的短样本探测，CI仍禁止付费服务。

## 独立诊断与后续 Provider

```sh
# 默认离线，显示当前模式、各能力实际选中的provider/model，不输出key。
npm run providers:probe -- --stage capabilities
# 明确调用所选识别器；使用短WAV文件，真实转录内容不写日志。
npm run providers:probe -- --stage stt --audio path/to/short.wav
# 一次LangGraph节点内规划，无自动修复或HTTP重试。
npm run providers:probe -- --stage plan --text "你好"
# 一句合成，可选保存；既有文件不会覆盖。
npm run providers:probe -- --stage tts --text "你好，请坐。" --output outputs/probe.mp3
```

诊断读取apps/server/.env，进程环境优先。正式应用启动校验全部必要服务；单阶段probe只要求该阶段的凭证，capabilities无需凭证且不联网；其他stage在APP_MODE=live时是付费Provider请求，45秒总上限，最多一次调用，planner上限300输出tokens，失败不会切Mock。输出仅provider/model、耗时、字节/字数、request ID及安全错误码/status；不打印原始转录、对话、配置、鉴权头或Provider错误正文。详细类职责、替换例子与复用测试见[Provider架构](architecture/providers.md)。

## 场景规划边界

GPT适配不再直接导入咖啡馆身份/prompt，由Graph传入scenario的systemPrompt、已公开scene与allowedActions。私有PlannerOutput含actionId和推荐元数据，Graph再转换为公开ReplyPlan或Ink演出。普通聊天保留同次生成推荐，关键explicit选择不由模型自行执行。CONTEXT_HISTORY_TOKENS默认1800，使用本地估算与LangChain trimMessages裁剪历史，不代表GPT总context上限，不调用额外计数或摘要服务。
