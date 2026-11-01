# 部署与运维

## 无密钥 Docker 演示

```sh
docker compose --profile demo up --build -d
```

访问 http://localhost:8080。前端 nginx 与 API 是独立容器，浏览器只看到 localhost:8080；nginx 转发 /api，浏览器不会访问 Docker 内部主机名。默认 Mock+Local，API不向宿主机暴露端口。容器以非root用户运行；server镜像安装FFmpeg供受限录音解码，动态媒体在私有volume。

```sh
docker compose --profile demo logs --tail=80 api
docker compose --profile demo down
```

正常关闭保留volume；不默认删除数据卷。若重建API，会话失效，需要重新进入。

## CF Pages + 云服务器

Pages仓库根构建：`npm ci && npm run build:web`；输出 `apps/web/dist`。构建环境 `NODE_VERSION=26.13.0`、`VITE_API_BASE_URL=https://api.example.com`，示例域名需替换。不提供顶层 `404.html` 时使用 Pages 内置 SPA 回退；不要再添加 `/* /index.html 200`，该规则会被 Pages 的 HTML 路径规范化判定为循环并忽略。每个预览环境显式配置API origin，后端CORS只列可信的完整origin。生产前端不使用Pages Functions。

### 72-mvp 前端持续部署

Cloudflare Pages 项目 `72-mvp` 连接 `konbluesky/72-mvp-homework`，生产分支为 `main`，自定义域名为 `https://72-mvp.telegrow.app`。框架预设选择 None，根目录留空，构建命令使用 `npm ci && npm run build:web`，输出目录为 `apps/web/dist`。设置 `NODE_VERSION=26.13.0`、`NPM_VERSION=11.20.0` 和 `SKIP_DEPENDENCY_INSTALL=true`，由构建命令统一执行锁文件安装。

推送到 `main` 后由 Pages Git 集成自动构建和发布；其他分支用于预览。GitHub Actions 的独立 Frontend build job 也会构建前端并保留 7 天的 `frontend-dist` 构建产物，原有完整验证 job 继续执行。Pages 构建不依赖 GitHub Actions 的完成状态。

首次上线仅包含前端，后端单独部署，因此暂不配置 `VITE_API_BASE_URL`，会话、对话和语音暂不可用。后端就绪后，在 Pages 的生产构建变量中填入其 HTTPS origin，并重新部署；后端 CORS 允许 `https://72-mvp.telegrow.app`。原版入口为 `/`，WebGAL 入口为 `/webgal.html`。

云服务器构建 `infra/docker/server.Dockerfile`，由secret manager/env_file注入后端配置（勿把真实env加入镜像）。只运行一个Node进程/副本，绑定回环端口或私有容器网络。使用 [nginx示例](nginx-production.conf) 终止TLS，禁用SSE buffering/cache，保持心跳及140秒read timeout。公开部署前核验域名、证书、代理信任IP/CIDR与防火墙；配置明确允许的origin，不能通配所有Pages预览域。

`GET /healthz` 只查存活，`GET /readyz` 只查已加载模式；都不产生模型费用。Live凭证不完整启动失败，探针不证明远程账户可用。

## 页面连接监测与自动恢复

页面使用独立常驻SSE检测连接，并以轻量HTTP请求采样RTT；具体接口、状态、所有权与不重播边界见[连接监测说明](connection-health.md)。不增加WebSocket，也不以健康探针调用付费Provider。Compose nginx明确代理旧healthz/readyz，不能让SPA回退的HTML 200充当健康JSON。

## 资源和故障预算

会话、每会话历史、轮次、输入速率、全局任务/上传并发、计划片段、媒体容量均有上限。配置默认值见`.env.example`与schema。录音≤15秒（编码尾部250ms容差），上传≤4MiB；FFmpeg只接stdin，不接受任意网络协议，最多2个、5秒墙钟、有限PCM/stderr输出；超时/取消立即kill。原始录音只在内存中处理，不保存。

媒体默认10分钟TTL、64MiB总量；Local与R2共用业务属主/过期校验，R2 lifecycle只作兜底。API进程重启后旧媒体索引失效，Local孤儿文件定期清理；R2应额外设置bucket lifecycle清理无法恢复的孤儿对象。私有音频不发布至前端public目录。

日志记录身份、阶段、耗时、错误码；默认不记录完整对话/录音/Authorization。Provider usage不可用时记录unknown。Mock样本不能推导真实服务P50/P95或成本；首次Live验收使用显式小样本与独立预算。

## 故障恢复与回滚

- 会话过期/服务重启：重新进入，明确本次故事已结束。
- STT/LLM/TTS失败：本轮结束，可换文字/再发新轮，不自动重复计费。
- 下载/解码失败：可重试声音或逐句字幕确认；嘴部不假装发声。
- 照片失败：继续对话或重新请求；不写photo事实，也不执行依赖它的环境变化。
- SSE断流：取消原stream任务，新轮不受旧finally影响；自动恢复监测与会话，补交回执后查快照，不自动重发输入或重播。
- 容量/限流：等待窗口释放；不要通过扩大模型并发掩盖故障。

回滚使用上一已验证镜像与对应前端构建；schemaVersion变更应一起协调发布。首版无数据库迁移，但API重启丢失会话。扩容前必须设计共享状态、任务归属与取消路由，不能直接增加replicas。

## 后续两周

第一周：真实供应商小样本联调、中文音色试听、原创Mira的Live2D小样绑定与过渡中打断；补iOS Safari/Android Chrome真机权限和播放测量。第二周：生产HTTPS/SSE代理验收、真实延迟与成本预算、素材精修；若有明确恢复需求再引入持久化会话。VAD/动态视频/多角色不进入当前关键路径。

本地Compose启动后可运行 `npm run smoke:demo` 验证nginx SSE与媒体/鉴权/回执闭环。它只允许Mock模式，模拟呈现回执；真实浏览器播放与图片呈现由 `npm run test:e2e` 验证。

已运行的部署也可使用 `E2E_BASE_URL=http://localhost:8080 npm run test:e2e` 验收；指定该变量时不会另起dev服务。批量测试宜在独立测试环境设置会话创建限额，结束后恢复默认。Live2D模型/运行时在 `/assets/live2d`，必须与前端构建一起发布，不依赖CDN。
