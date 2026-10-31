# Deepgram完整接入与Provider对象设计验收

日期：2026-10-31。对应用户要求“完整接入Deepgram，OOD，为后面调试其他provider准备”。上一份仅Live文字输入的识别移除记录（本地历史稿）是中间历史，当前已恢复Live录音。

## 已实现

- 三个独立接口与具体适配类：SpeechToTextProvider、ReplyPlanner、TextToSpeechProvider；ProviderSet只组合stt/planner/tts。组合测试实际替换一个识别器并通过同一个Graph、GPT、TTS，无业务层厂商分支。
- DeepgramStt使用官方/v1/listen，规范化WAV二进制、Token鉴权、Nova-3/zh-CN默认、有限JSON响应与结构校验、静音/异常拒绝；DeepgramTts使用既有Flux中文音色/v2/speak/MP3。共用一把key和有界HTTP transport，模型/超时独立。
- Mock拆为三个类，识别结果自带simulated标记；Live绝不因失败改用固定模拟转录。
- 创建会话与快照返回capabilities.voiceInput，前端按实际能力开放麦克风。显式STT_PROVIDER=disabled仍可运行文字对话，未知Provider配置拒绝。
- 图与Provider继续传播AbortSignal，超时/迟到结果/播放回执/资源上限不变。日志增加provider/model和可用request ID；错误只记录安全status/code，不打印凭证、录音、对话或供应商正文。
- providers:probe默认离线显示所选能力；显式stt/plan/tts阶段支持受限真实调试。Planner探测也通过LangGraph，限制一次调用、0重试和300输出tokens。单阶段仅要求该服务凭证；正式应用仍校验完整Live配置。
- 媒体格式验证移至media/audio-format.ts，存储不再依赖LLM SDK或Live适配文件。没有引入通用注册平台、DI容器或额外SDK。

## 自动验证

| 命令                                                | 结果                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| npm run check                                       | 24文件/169项核心测试通过；4项运行时测试通过；typecheck、lint、格式通过；Live2D 21条资源哈希通过 |
| npm run build                                       | protocol、server、web生产构建通过                                                               |
| npm run contracts:generate / contracts:check        | 会话能力字段从共享schema与真实路由生成，SwaggerParser验证及一致性检查通过                       |
| E2E_BASE_URL=http://127.0.0.1:5273 npm run test:e2e | 13项全部通过，包含真实录音→Live适配器→Graph→MP3实际播放/照片/打断，供应商HTTP受控               |

关键新增用例：二进制WAV与官方URL/鉴权；空/超长/坏JSON、401/403/429/500、响应体超限、独立超时/非配合取消、完整HTTP→Graph三段链路、替换单个能力、能力协商、浏览器真实MediaRecorder/MP3解码/播放/照片/打断。tests/e2e/deepgram.spec.ts用真实采集和播放，只替换供应商HTTP响应，后端实际运行Live类和LangGraph；所有CI/普通测试不调用付费服务。

## 明确执行的真实小样本

使用现有apps/server/.env，未更改用户GPT模型、音色或凭证。没有记录凭证或响应全文。

| 探测                                            | 结果                                                                  | 证据范围                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| --stage capabilities                            | Live，Deepgram nova-3 / 用户GPT / Deepgram flux-lijuan-zh             | 离线，无服务请求                                                  |
| --stage stt --audio assets/mock-audio/hello.wav | HTTP成功但转录为空，返回NO_SPEECH                                     | 机械离线Mock音频不作为中文识别质量样本；没有假造转录/调用后续模型 |
| --stage tts --text “你好，请坐。”               | 成功，7056字节MP3，request ID可用                                     | ffprobe实际时长1.176秒；文件见下方                                |
| 合成MP3规范化为WAV再--stage stt                 | Nova-3成功，真实转录4字、simulated=false、时长1.176秒，request ID可用 | 证明现有账户识别与合成均可调用，不等于真人或广泛语料准确率验收    |
| --stage plan --text “你好”                      | 用户GPT在LangGraph节点内成功，结构合法，1片段22字                     | 单次有界调用，无自动修复或重试；没有将该阶段称为云端浏览器全链路  |

共3次Deepgram请求（2识别、1合成）和1次GPT请求。所有后续回归使用受控数据；没有批量云服务回归或自动探针。响应usage/价格未用于成本估算，不将单点耗时推导为P50/P95。

真实合成音频（本地留存）和机器证据（本地留存）可复查。真人听感、真实麦克风中文识别质量、iOS Safari/Android Chrome、公开HTTPS/SSE与R2账户均未在本轮验证。当前是按住录音REST与句级回复，WebSocket流式/STT partial/VAD/全双工仍属后续范围。

## 使用和后续扩展

实际配置与命令见[Provider配置](../provider-configuration.md)，类边界、替换示例、测试复用见[Provider架构](../architecture/providers.md)。现有Deepgram key即可；新增识别模型/语言有已核验默认值，TTS继续使用已有音色。前后端需一起升级（后端先发布），新前端需要capabilities字段。

原始截图、录像与机器证据仅本地留存，未纳入公开仓库；此处为既有执行摘要，本次版本控制整理未重新执行这些测试。
