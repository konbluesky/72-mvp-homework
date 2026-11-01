# 开发与排错

VS Code 用户可使用 [F5 一键启动与调试](vscode.md)：自动选择项目 Node/npm，读取后端 `.env`，等待就绪后打开 Chrome，停止时一起结束本次调试。

需要 Node 26.13.0 / npm 11.20.0；语音录制上传需本机 FFmpeg（macOS `brew install ffmpeg`，Debian/Ubuntu `apt-get install ffmpeg`），文字路径无需FFmpeg。Docker镜像已包含。使用 nvm 时 `nvm install && nvm use`；Node 官方对应发行版内置 npm 11.20.0。

```sh
node scripts/project.mjs ci
npm run dev
```

浏览器打开 http://localhost:5173；API http://localhost:3000。默认 Mock+Local 无需复制 env。Vite 对 /api 转发到独立 API。切换远端API时复制 `.env.frontend.example` 到 `apps/web/.env.local` 并填写 VITE_API_BASE_URL（origin）。后端配置复制 `.env.example` 到 `apps/server/.env`，入口显式加载；进程环境变量优先。

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

当前角色是同源真实Live2D，模型与21条资源哈希通过 `npm run assets:check` 验证。加载失败可点击“重新加载角色”；浏览器需WebGL。旧 `VITE_RIVE_SRC` 已移除，不再支持旧Rive分支。替换最终Mira模型时需更新受控manifest/参数能力和对应测试，不接受模型输出提供资源URL。

## Ink内容编辑

故事位于 `apps/server/src/scenario/cafe/`。编辑main/scenes/endings的Ink或角色/Lore/manifest JSON后运行 `npm run scenarios:build`；`npm run scenarios:check`校验源码与产物一致。compile命令仅在内容变化时写artifact，避免重复编译无意义触发dev重载。dev准备、typecheck与server构建已包含编译步骤；生成compiled.json不入库、不手改，生产发布包含其dist副本。

Ink选择tag写在选择方括号内部；每个呈现beat的变量更新放在输出行之前，必须有一个白名单cue。包含台词的beat先等台词实际播放/字幕确认，再等主要视觉回执；跨beat不依靠全局setTimeout推进。会话固定artifact hash；dev内容改动或后端重载后旧会话可能失效，须明确重开。

默认原版聊天与WebGAL故事入口同时保留，分别使用conversation/story初始条件。调试复用用户已启动的dev服务；未经要求不要另起进程或切换运行模式。

## 演示限流

`NODE_ENV=development`（含未设置时）默认 `RATE_LIMIT_ENABLED=false`：不限制每 IP 每分钟创建会话次数，也不限制每会话每分钟输入次数；不会累计这两类频率计数。`production` / `test` 默认开启，仍使用 10 次创建/分钟、12 次输入/分钟，可通过环境变量显式覆盖。`apps/server/.env` 或进程环境中的 `RATE_LIMIT_ENABLED` 优先于环境默认值。

开关只影响请求频率；并发轮次、会话总量、上传大小和超时预算继续有效，Deepgram / GPT 的账户额度与限流也继续由供应商控制。开启频率限制时，仅成功创建会话消耗创建额度，初始化失败不计数。修改后端配置需重载 API；内存会话随 API 重启失效，页面应显式重新开始。
