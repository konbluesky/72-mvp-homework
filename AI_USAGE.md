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
