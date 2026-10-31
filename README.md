# 雨停之前 · Mira

雨夜咖啡馆中的单角色互动场景。Vue 3 场景页面（真实 Live2D） + 独立 Fastify/Node 后端，文字和按住说话共用 LangGraph、SSE、音频播放与事件回执链路。

## 最短启动

VS Code 支持 [F5 一键启动前后端与 Chrome](docs/development/vscode.md)，自动选择项目 Node/npm，并读取后端 `.env`；默认 Mock+Local，无需三方密钥。

开发需要 **Node 26.13.0 / npm 11.20.0**（见`.nvmrc`）；语音上传需 FFmpeg，macOS `brew install ffmpeg`。不配置任何供应商key即可运行：

```sh
node scripts/project.mjs ci
npm run dev
```

打开 [http://localhost:5173](http://localhost:5173)，API默认为3000。若端口被占用：`PORT=3100 API_PROXY_TARGET=http://127.0.0.1:3100 npm run dev`。

三方服务只需填写 `apps/server/.env` 的 GPT/Deepgram 字段。Live 采用 Deepgram 识别 → GPT → Deepgram 语音合成；同一 Deepgram key 覆盖识别与合成。前端本地代理无需额外配置。高级部署/限额参数已移到 `.env.advanced.example`，详见 [Provider 配置](docs/provider-configuration.md)。

有 Docker 时使用包含FFmpeg的完整无密钥演示：

```sh
docker compose --profile demo up --build -d
```

打开 [http://localhost:8080](http://localhost:8080)。首次镜像下载时间取决于网络；前后端独立容器，默认Mock+Local。关闭：`docker compose --profile demo down`。

## 交付状态

| 范围                           | 状态                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| 工程、共享协议、前后端独立构建 | 已实现                                                            |
| 无密钥 Mock 纵向闭环           | 已实现；最终验证结果见验收记录                                    |
| GPT / Deepgram / R2            | 具体适配与受控契约测试已实现；未使用真实凭证联调                  |
| 中文 Mock 音频                 | 本地离线合成语音，字幕文本与音频manifest对应；机械音色            |
| 角色演出                       | 真实Live2D：四态、三情绪、望窗、音频能量口型；照片/雨势由对话驱动 |
| 正式角色资产                   | 当前官方Haru是技术替身；原创Mira模型与专用递照片手势待制作        |
| 真机与生产网络                 | iOS/Android真实麦克风、听感和生产HTTPS/SSE代理未验证              |

STT、规划、TTS使用独立接口和适配类，便于分别替换和调试。[Provider架构与调试](docs/architecture/providers.md)说明注入方式与逐阶段命令。

Mock只替换Provider。语音仍从真实MediaRecorder上传并由受限FFmpeg校验真实时长，**识别固定为明确标注的示例**；不会理解任意录音。所有LLM调用（含一次修复）位于LangGraph节点内。Live配置缺失直接报错，不自动回退Mock。Live语音识别由Deepgram提供，不回退为模拟转录。

## 使用与验收

试着输入“你在等谁？”、“我喜欢旅行”、“谢谢你，我陪你坐一会儿”、“能看看照片吗？”和“不要看照片”。音频实际开始才显示字幕并进入speaking。按住说话或点击打断会立即停播，旧下载、解码、动画和回执不能复活旧内容。

按住说话采用显式意图，避免首版引入VAD、附和判断及回声检测。录音最长15秒；上滑、Esc、失焦、页面隐藏取消。授权等待中松手后即使授权成功也不会录音。声音失败可选择逐句字幕确认，照片失败不会提交“已看过”。

```sh
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
npm run contracts:check
```

[Live2D改造验收](docs/acceptance/live2d-migration.md)记录实际命令、结果与缺口。[3–5分钟演示步骤](docs/acceptance/demo.md)覆盖互动、表情、打断、多模态和失败恢复。测试不会请求付费模型。

诊断默认不请求服务：`npm run providers:probe -- --stage capabilities`。显式的 `--stage stt|plan|tts` 在Live下调用对应真实Provider，详见[配置与调试说明](docs/provider-configuration.md)。

## 工程导航

- `packages/protocol`：Zod协议单一来源，HTTP DTO、SSE、ReplyPlan、receipt及枚举。
- `apps/web`：Vue/Pinia展示，独立录音意图与TurnController，唯一PlaybackScheduler，Live2D渲染边界。
- `apps/server`：Fastify路由与鉴权，SessionManager权威事实，LangGraph，Provider，Local/R2私有媒体。
- [架构与取舍](docs/architecture/decisions.md)、[API与生成OpenAPI](docs/contracts/README.md)、[开发排错](docs/development/README.md)、[部署与回滚](docs/operations/README.md)。
- [Provider配置](docs/provider-configuration.md)、[素材来源](assets/README.md)、[AI协作记录](AI_USAGE.md)、[工程文档索引](docs/README.md)。

模型只能生成短句、白名单情绪/动作/资源意图，不能指定URL、轮次身份或执行命令。generation决定单轮所有权，AbortSignal节约资源，身份检查决定副作用有效性。句子播完、照片实际可见、环境呈现分别回执；reply.done仅是生成结束。取消冻结最终呈现快照，新轮原子合并累计回执后才构造上下文。

会话为有容量与TTL上限的单进程内存；重启需要重新进入。首版不支持多副本、账号、付费、跨设备记忆或动态视频。没有真实供应商延迟样本，因此不报告P50/P95或成本。后续两周优先真实Provider小样本、原创Mira的Live2D模型与真机/生产代理验证，再按需求考虑持久化；详见运维文档。

本轮开发由主agent和三个子agent实施，工时未作独立计时，不虚构人工投入；命令与证据以2026-10-31验收记录为准。

当前二次元角色使用官方 Haru 样例作技术替身，页面有明确说明。原人物SVG贴片和Rive运行分支在替换验收后移除；图标和旅行照片SVG是独立UI/媒体资源。运行时和模型均同源发布，版本/来源/许可见[Live2D资源说明](apps/web/public/assets/live2d/NOTICE.md)，哈希校验使用 `npm run assets:check`。

## 版本控制范围

仓库仅包含源码、必要运行资产、测试源码、配置和当前文档。研究/旧设计、原始PDF、截图录像、依赖、构建产物及真实env均在本地保留并排除；Live2D固定运行库/模型与Mock语音是必要发行资产，随来源和条款提交。详见[版本控制说明](docs/development/version-control.md)。
