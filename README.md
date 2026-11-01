# 雨停之前：最后一盏灯

《最后一盏灯》是一段发生在雨夜咖啡馆的互动故事。用户可以用文字或语音与 Mira 交流，在咖啡馆的不同地点探索照片、告示与信件，并在了解她的处境后选择陪伴、出发或留下回信。

新版故事页位于 `/webgal.html`，以场景和角色为主体，不采用聊天列表作为主界面。根路径 `/` 与 `/legacy.html` 保留原版对话入口，便于继续使用既有交互。两种入口共享后端会话、语音服务与 Ink 剧情包，但使用不同的初始场景与可执行动作。

## 本地启动

项目使用 Node.js **26.13.0** 与 npm **11.20.0**。首次在新环境运行时，先安装项目指定的 Node 版本；项目启动器会选择锁定的 Node/npm。

```sh
nvm install 26.13.0
node scripts/project.mjs ci
npm run dev
```

如果已安装好依赖，只需运行 `npm run dev`。Web 页面地址为 [http://localhost:5173/webgal.html](http://localhost:5173/webgal.html)，兼容版地址为 [http://localhost:5173/](http://localhost:5173/)，API 默认监听 3000 端口。若项目服务已经在运行，直接使用现有地址，无需再启动一份。

默认 Mock + Local 模式不需要第三方密钥。麦克风录音上传需要本机安装 FFmpeg；macOS 可用 `brew install ffmpeg`，Debian/Ubuntu 可用 `sudo apt-get install ffmpeg`。文字输入和语音回复不依赖本机 FFmpeg。

也可以用 Docker 启动无密钥演示：

```sh
docker compose --profile demo up --build -d
```

打开 [http://localhost:8080](http://localhost:8080)。容器包含 FFmpeg，演示使用 Mock + Local。停止命令为 `docker compose --profile demo down`。

## 体验故事

在新版页面中，从雨夜街角进入咖啡馆，可以走近门头、查看大堂、窗边、照片墙、洗手区和吧台。和 Mira 对话、听她谈起等待的人、阅读告示或信件；推进剧情取决于当前故事状态和呈现确认，不由固定计时器触发。

到达可作决定的剧情节点后，可以选择一起出发、留下回信，或回窗边再坐一杯。每种选择都会改变后续地点、道具或环境状态。兼容版从窗边开始自由聊天，保留原有照片演出与语音输入能力。

## 语音与打断

Live 模式使用 Deepgram 识别录音、GPT 生成回复计划，再用 Deepgram 合成角色语音。按住麦克风说话，松开后录音会进入可编辑草稿；确认后才提交给故事。没有可用语音识别能力时，页面依据会话能力标记禁用录音入口。Mock 模式会明确标注示例转录，不假装识别任意录音。

角色正在说话时，可以按住麦克风开始新一轮，也可以使用打断操作。前端先停止当前音频并清理未播放字幕与演出，再向服务端提交新轮次；旧轮次的网络响应、解码结果或动画回调不能恢复旧内容。录音权限等待、录音草稿、音频播放与字幕降级会分别呈现，不把静音状态伪装成“正在说话”。

语音使用句级合成与 HTTP/SSE，不是 WebSocket 全双工实时语音。声音失败时可以重试或逐句确认字幕。音频播放、照片显示和环境变化分别产生回执；Ink 只提交已经满足前置条件且得到确认的故事进度。

## 系统结构

| 部分                            | 职责                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `apps/web` 新版故事页           | React、WebGAL、Pixi 与 Live2D 角色舞台；处理地点界面、录音草稿、交互状态与本地播放 |
| `apps/web` 兼容页               | Vue 对话入口，复用会话与播放控制器，保留原有对话交互                               |
| `apps/server`                   | Fastify API、匿名会话、单轮所有权、LangGraph、语音 Provider 与私有媒体             |
| `apps/server/src/scenario/cafe` | Ink 故事、角色说明、Lore、地点和合法剧情动作                                       |
| `packages/protocol`             | 共享 Zod 协议，供会话、HTTP、SSE、回复计划和呈现回执使用                           |
| `apps/web/third-party/webgal`   | 固定版本的 WebGAL 引擎源码、补丁与上游来源清单                                     |

GPT 只产生通过 schema 和当前故事状态校验的回复与建议。可见地点、道具、结局和合法动作由服务端 Ink Runtime 管理；模型不能直接决定任意资源路径或提交故事事实。SessionManager 保存权威会话状态、回执确认和已提交的 Ink checkpoint。

Live2D 角色交互状态（待机、倾听、思考、说话）与情绪（戒备、好奇、释然）分别驱动；望窗和递照片动作由当前场景事件触发。声音只由 PlaybackScheduler 播放，角色嘴型读取实际音频能量。人物动画提示不会代替照片、信件或地点的呈现回执。

## 模型、服务与素材

| 能力       | 当前方案                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------- |
| 规划与对话 | 用户配置的 OpenAI 兼容 GPT Provider；所有规划与有限修复均在 LangGraph 节点内                       |
| 语音识别   | Deepgram Nova-3，默认语言 `zh-CN`；Live 缺少有效配置时明确禁用或报错                               |
| 语音合成   | Deepgram Flux 中文音色；具体音色名由用户配置，账户权限和听感需按实际账号确认                       |
| 角色渲染   | Pixi/Cubism Live2D；两页均默认使用 Live2D 官方 Haru 样例，WebGAL 页保留 Miara 显式切换             |
| 场景与图像 | 项目绘制的本地 SVG 咖啡馆背景及旅行照片；没有动态图片或视频生成                                    |
| 媒体存储   | 默认私有 LocalMediaStore；可配置 Cloudflare R2 S3 存储                                             |
| 离线语音   | Mock 使用随仓库提供的 eSpeak NG 合成样本；具体文本、来源与哈希见 `assets/mock-audio/manifest.json` |

Live2D 模型、Cubism Runtime、来源与适用条款见 [`apps/web/public/assets/live2d/NOTICE.md`](apps/web/public/assets/live2d/NOTICE.md)。WebGAL 引擎遵循其固定来源及许可说明，见 [`apps/web/third-party/webgal/README.md`](apps/web/third-party/webgal/README.md)、`LICENSE` 与 `SOURCES.json`。场景素材来源见 [`apps/web/public/assets/cafe-story/README.md`](apps/web/public/assets/cafe-story/README.md) 和 [`assets/README.md`](assets/README.md)。

## 主要取舍与已知限制

- 用按住说话替代 VAD 和自动打断，缩小实时音频范围并让用户明确控制录音。
- 使用逐句 REST 合成，方便让字幕、动作和实际播放对应；代价是首句等待会比全双工流式系统明显。
- 使用 Ink 管理跨地点剧情与结局，模型只提供受限的对话和建议；这降低自由生成对事实的控制，但不能保证所有自然语言都完全符合剧情语义。
- 会话与 Ink checkpoint 保存在单进程内存，服务重启后当前故事进度需要重新开始；当前不支持多实例共享会话。
- 当前 Live2D 使用官方技术样例而非原创 Mira 模型，没有 Mira 专属服装和递照片动作。兼容页以及 Live2D 的真机行为仍需要独立设备验证。
- Deepgram/GPT 账户能力、中文音色权限和听感、iOS Safari / Android Chrome、公开 HTTPS 与生产 SSE 代理不能由 Mock 或本地浏览器检查替代。
- 当前没有公开部署地址。无密钥演示需在本地启动；自动化录屏不捕获系统声音，麦克风使用测试设备。

接口与环境配置见 [`docs/provider-configuration.md`](docs/provider-configuration.md)，剧情实现和边界见 [`docs/acceptance/narrative-ink.md`](docs/acceptance/narrative-ink.md)，Provider 验证记录见 [`docs/acceptance/deepgram-integration.md`](docs/acceptance/deepgram-integration.md)，Live2D 来源和验证范围见 [`docs/acceptance/live2d-migration.md`](docs/acceptance/live2d-migration.md)。这些记录描述各自执行时的工作区状态，不代表本次 README 整理重新运行了验证。

本地自动演示录像位于 [outputs/acceptance/live2d/demo/mira-demo.mp4](outputs/acceptance/live2d/demo/mira-demo.mp4)，时长约 3 分钟。输出目录不纳入仓库；源码交付时需另行附上录屏。录像为自动化浏览器操作，不捕获系统声音，麦克风使用测试设备。

## 开发投入与后续两周

本项目没有持续记录实际开发工时，不能根据日历日期或 AI 协作次数推算投入；提交前应由实际参与者补记可追溯工时。AI 使用和人工验证边界见 [`AI_USAGE.md`](AI_USAGE.md)。

如果继续开发两周，计划先制作原创 Mira Live2D 模型并验证参数动作，再用真实麦克风和 Deepgram 做短样本质量验收，覆盖录音权限、音色与打断；随后在 iOS Safari 和 Android Chrome 检查播放、键盘与后台恢复，并在有 HTTPS 的服务器部署中验证反向代理和 SSE。最后根据实际运行观察决定是否加入持久化 checkpoint；不先扩大到多角色或生成式视频。

账号注册、付费、管理后台、原生移动应用、模型训练、多角色市场和大型生产集群均不在当前 MVP 范围内。测试与开发命令见根目录 `package.json`，实际执行遵循 [`AGENTS.md`](AGENTS.md) 中的约束。
