# 开发与排错

VS Code 用户可使用 [F5 一键启动与调试](vscode.md)：自动选择项目 Node/npm，读取后端 `.env`，等待就绪后打开 Chrome，停止时一起结束本次调试。

需要 Node 26.13.0 / npm 11.20.0；语音录制上传需本机 FFmpeg（macOS `brew install ffmpeg`，Debian/Ubuntu `apt-get install ffmpeg`），文字路径无需FFmpeg。Docker镜像已包含。使用 nvm 时 `nvm install && nvm use`；Node 官方对应发行版内置 npm 11.20.0。

```sh
node scripts/project.mjs ci
npm run dev
```

首次启动前，将 `.env.example` 复制到 `apps/server/.env` 并填写 Live 的 GPT / Deepgram 配置；已有配置直接编辑。无密钥演示显式设置 `APP_MODE=mock` 并清空服务密钥。浏览器打开 http://localhost:5173；API http://localhost:3000。Vite 对 /api 转发到独立 API。切换远端API时复制 `.env.frontend.example` 到 `apps/web/.env.local` 并填写 VITE_API_BASE_URL（origin）。后端入口显式加载 `apps/server/.env`，进程环境变量优先。

`npm run dev` 和 VS Code 任务会自动选用 `.nvmrc` 对应的 nvm 运行时，不要求 GUI 的 PATH 已切换。其他 npm 命令应在正确运行时下执行，或使用 `node scripts/project.mjs check`、`node scripts/project.mjs build`。最小模板只保留业务字段，高级覆盖见 `.env.advanced.example`；Live通过Deepgram识别和合成；Mock保留同一录音与调度路径并标注模拟转录。

| 命令                                         | 用途                                 |
| -------------------------------------------- | ------------------------------------ |
| npm run check                                | 类型、lint、格式、核心测试           |
| npm run build                                | 共享包 → server → web                |
| npm run build:web / build:server             | 各自构建，自动先构建协议             |
| npm run test:e2e                             | Playwright跨应用浏览器验收           |
| npm run contracts:generate / contracts:check | OpenAPI生成/验证一致性               |
| npm run format                               | 格式化实现与新文档，保留原始设计资料 |

首次 E2E 安装 `npx playwright install chromium`（Linux CI 加 --with-deps）。测试只用 Mock/受控HTTP，不会调用付费服务。测试日志不应包含录音正文、对话全文、密钥或token。

麦克风需要 localhost 或 HTTPS。移动设备访问开发机局域网普通HTTP无法证明录音可用；真机请用HTTPS测试域名。语音按住录制，松开后识别并预览，可二次编辑、确认后发送，上滑/失焦/隐藏取消；首次授权中松手不会偷偷开始录音。

无声时检查浏览器站点声音权限；点击进入/发送手势解锁 AudioContext。选择字幕继续会逐句等待确认，不自动假装已听完。麦克风拒绝可改文字；断网可重新连接，重启后会话过期则重新进入。

前端环境变量只允许公开API origin及公开资产路径；勿用VITE前缀注入服务端密钥。Live配置缺失会直接启动失败，详见 [Provider说明](../provider-configuration.md)。

若默认3000已被占用：`PORT=3100 API_PROXY_TARGET=http://127.0.0.1:3100 npm run dev`。不要停止不属于本项目的进程。本次宿主验收使用该覆盖，工程默认端口保持3000。

当前角色是同源真实 Live2D，模型来源与资源哈希由 `npm run assets:check` 验证；检查还覆盖公开资产库存/引用和离线 WAV。Haru 默认，WebGAL 可显式选择 Miara；加载失败可重试，浏览器需 WebGL。旧 `VITE_RIVE_SRC` 已移除，不再支持旧 Rive 分支。替换角色模型时需更新受控 manifest/参数能力和对应测试，不接受模型输出提供资源 URL。

## Ink内容编辑

故事位于 `apps/server/src/scenario/cafe/`。编辑main/scenes/endings的Ink或角色/Lore/manifest JSON后运行 `npm run scenarios:build`；`npm run scenarios:check`校验源码与产物一致。compile命令仅在内容变化时写artifact，避免重复编译无意义触发dev重载。dev准备、typecheck与server构建已包含编译步骤；生成compiled.json不入库、不手改，生产发布包含其dist副本。

Ink选择tag写在选择方括号内部；每个呈现beat的变量更新放在输出行之前，必须有一个白名单cue。包含台词的beat先等台词实际播放/字幕确认，再等主要视觉回执；跨beat不依靠全局setTimeout推进。会话固定artifact hash；dev内容改动或后端重载后旧会话可能失效，须明确重开。

默认 `/` 打开 WebGAL 故事，`/webgal.html` 保留同一入口；原版聊天保留在 `/legacy.html`，分别使用 story/conversation 初始条件。调试复用用户已启动的dev服务；未经要求不要另起进程或切换运行模式。

## 演示限流

会话默认不按时间过期：`SESSION_TTL_SECONDS=0`（默认）使 `expiresAt` 为 null，刷新、离开页面或暂时断网后可继续原会话。仅明确重新开始时替换并释放自己的旧会话名额。需要有限时长时设置正整数秒数，例如 `604800` 为 7 天；媒体清理和单轮超时仍独立生效。后端目前只存内存，服务重启/故事版本不兼容仍需重新开始。

`NODE_ENV=development`（含未设置时）默认 `RATE_LIMIT_ENABLED=false`：不限制每 IP 每分钟创建会话次数，也不限制每会话每分钟输入次数；不会累计这两类频率计数。`production` / `test` 默认开启，仍使用 10 次创建/分钟、12 次输入/分钟，可通过环境变量显式覆盖。`apps/server/.env` 或进程环境中的 `RATE_LIMIT_ENABLED` 优先于环境默认值。

开关只影响请求频率；并发轮次、会话总量、上传大小和超时预算继续有效，Deepgram / GPT 的账户额度与限流也继续由供应商控制。开启频率限制时，仅成功创建会话消耗创建额度，初始化失败不计数。修改后端配置需重载 API；内存会话随 API 重启失效，页面应显式重新开始。

## 2026-11-02 安装与启动验收

使用独立源码快照验证，未复制 `node_modules`、`dist`、私人 `.env` 或被忽略的 `compiled.json`。宿主为 macOS arm64、Node 26.13.0 / npm 11.20.0；另在 Linux arm64 Docker 容器中验证生产启动。快照场景版本为 `last-lamp@3.0.4`，依赖锁文件 SHA-256 为 `bd6fb839986da77c816de231ce2cf7db90a8a9fc6aca100d6ed4c8fd89bdff5e`。

| 检查                                                                     | 实际结果                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `npm ci`，全新 npm 缓存与依赖目录                                        | 安装 613 个包，首次约 26 秒；未修改锁文件                                |
| `npm run build`                                                          | protocol、parser、server、web 构建通过，包含 Ink 自动编译                |
| `npm run dev`                                                            | 前端、API、Vite 代理就绪；删除 Ink 产物后也能自动重新生成                |
| Docker 构建与 `up -d --wait`                                             | 两个镜像构建、API 与前端健康启动通过；容器内 Node 26.13.0、FFmpeg 可执行 |
| 独立浏览器加载两个页面                                                   | 开发模式与 Docker 生产页面均加载成功，单 canvas，未捕获 pageerror        |
| 原版页面无密钥文字往返                                                   | 发送文字、收到字幕并确认下一句通过；没有伪造音频或调用付费 Provider      |
| `npm run test:runtime`                                                   | 4 项通过                                                                 |
| 新增入口兼容回归                                                         | 1 项通过：原版在陪伴承诺前及可选剧情后仍能自由对话，新故事入口门槛保留   |
| `contracts:check` / `scenarios:check` / `modules:check` / `assets:check` | 全部通过                                                                 |
| 既有 `scenario/cafe/story.test.ts`                                       | 6 项中 2 项通过、4 项失败；不能据此判定剧情或完整交付通过                |

本次修复原版入口被新故事的陪伴条件误拦截；只让 conversation 模式保留自由聊天，不添加陪伴事实。Docker 的 FFmpeg 安装首次因 Debian 下载返回 HTTP 502 失败，增加 APT 有界重试后重建并启动成功。

仍需处理的 4 项剧情回归：进店问候与告示、未见面前告别、菜单呈现不改变关系进度、离店中断后的确认前缀。其中三项报告“故事片段缺少呈现锚点”，一项触发 Ink 运行错误。它们属于剧情行为问题，安装成功和静态编译通过不能替代这些回归。

验证使用独立端口和 Docker project，无需复制真实凭证；本次创建的服务在检查后停止，不结束其他项目的进程或删除其数据。此次未运行全仓 `npm run check` 或完整 E2E 套件，未调用真实 GPT、Deepgram、ComfyUI，也未验证 Windows 原生环境、手机真机或生产网络。源码仍有并行编辑，结果仅对应上述工作区快照；后续源码变化须重新核对。
