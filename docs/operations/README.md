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

前端已发布，后端已于 2026-11-01 部署到 `my-xin-2`，见下节。正式 API origin 为 `https://api-72-mvp.telegrow.app`，Pages 生产变量 `VITE_API_BASE_URL` 已设为该地址；修改构建变量后需重新部署才会进入浏览器产物。后端 CORS 允许 `https://72-mvp.telegrow.app`。原版入口为 `/`，WebGAL 入口为 `/webgal.html`。

本次通过 Pages 重试生产构建，使 API 地址生效；部署 `885594f8-12ef-48c0-a0b1-2bb765eed96a` 已成功，源码为 `main` 的 `66de54b0`。此操作没有提交或发布本地尚未提交的前端改动。

云服务器构建 `infra/docker/server.Dockerfile`，由secret manager/env_file注入后端配置（勿把真实env加入镜像）。只运行一个Node进程/副本，绑定回环端口或私有容器网络。使用 [nginx示例](nginx-production.conf) 终止TLS，禁用SSE buffering/cache，保持心跳及140秒read timeout。公开部署前核验域名、证书、代理信任IP/CIDR与防火墙；配置明确允许的origin，不能通配所有Pages预览域。

`GET /healthz` 只查存活，`GET /readyz` 只查已加载模式；都不产生模型费用。Live凭证不完整启动失败，探针不证明远程账户可用。

### my-xin-2 后端部署

2026-11-01 首次部署后端，基础提交为 `66de54b0`，首发包含当时未提交的场景编译脚本修正。后续自动发布使用 GitHub 上已提交的源码。独立安装 Node 26.13.0 / npm 11.20.0，不替换其他业务使用的 Node；系统安装 FFmpeg。

| 项目             | 位置或配置                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| SSH / 部署根目录 | `ssh my-xin-2` / `/home/ubuntu/work/72-mvp-homework`                                                                                    |
| 当前版本         | `current` 指向已发布的 `releases/<commit>-<run_id>-<attempt>`；`current/release.json` 记录提交与 Actions 运行标识                       |
| 进程             | `72-mvp-api.service`，单实例，以 `ubuntu` 运行，开机自启、失败重启                                                                      |
| API 监听         | `127.0.0.1:3072`；服务器已有业务占用 3000                                                                                               |
| 运行配置         | `shared/production.env`；Live 凭证在权限为 0600 的 `shared/server.env`，由 `apps/server/.env` 软链接加载                                |
| 私有媒体         | `shared/media`，独立于发布版本；不部署本地录音或媒体数据                                                                                |
| Nginx            | `/etc/nginx/conf.d/72-mvp-api.conf`；HTTPS 代理到 3072，关闭 SSE buffering/cache/gzip，读取超时 140 秒，上传限制 5 MiB                  |
| 正式入口         | `https://api-72-mvp.telegrow.app`；HTTP/IP 请求跳转到正式 HTTPS 域名                                                                    |
| DNS              | Cloudflare A 记录 `api-72-mvp` → `13.140.169.32`，仅 DNS，由源站终止 TLS                                                                |
| HTTPS            | Let's Encrypt，证书位于 `/etc/letsencrypt/live/api-72-mvp.telegrow.app/`；首次证书到期日 2027-01-30                                     |
| 证书续期         | `certbot.timer` 已启用；webroot 为 `/var/www/72-mvp-acme`，续期后 `/etc/letsencrypt/renewal-hooks/deploy/72-mvp-nginx` 校验并重载 Nginx |

生产配置启用限流，仅信任回环代理，CORS 仅允许 `https://72-mvp.telegrow.app`。运行配置中的 `PUBLIC_API_BASE_URL` 为正式 HTTPS origin；凭证仅留在后端，不加入 Pages 变量。

本次完成服务器 `npm ci`、`npm run build:server`、`npm run scenarios:check`、systemd 单元校验、`nginx -t`、证书签发与续期定时器检查，以及进程直连、Nginx 和公网 HTTPS 的无费用存活/就绪检查、生产 origin 的 CORS 预检与 HTTP 跳转核验。未运行功能、运行时或 E2E 测试，也未调用付费 Provider；Live 就绪只证明配置已加载。

运维命令：

```sh
ssh my-xin-2
sudo systemctl status 72-mvp-api.service
sudo journalctl -u 72-mvp-api.service -n 80 --no-pager
sudo systemctl restart 72-mvp-api.service
sudo nginx -t && sudo systemctl reload nginx
```

后续发布在新的 `releases/<版本>` 目录安装依赖并构建，链接 `apps/server/.env` 到共享配置，再切换 `current` 并重启服务；不要覆盖正在运行的版本。回滚时将 `current` 切回保留的旧版本并重启；重启会丢失当前内存会话。

### GitHub Actions 自动发布后端

[Backend deploy](../../.github/workflows/backend.yml) 在推送 `main` 时自动执行，也支持在 Actions 中选择 `main` 后手动运行。涉及后端或发布配置的 PR 仅执行构建，不访问生产凭证或部署服务器。

后端门禁依次执行 `npm ci`、发布脚本语法检查、`npm run build:server`、`npm run scenarios:check` 和 `npm run contracts:check`。这些门禁通过后，打包已编译的服务端与协议、生产安装所需的包清单/锁文件，以及仓库内的 Mock 音频资产；不打包 `.env`、本地媒体、源码或 `node_modules`。

这是独立的后端发布门禁，不依赖原有 `verify` 工作流。配置时原有综合 CI 仍有 52 项测试失败，不能把后端发布成功解释为这些测试已修复。后端工作流不运行功能、运行时或 E2E 测试，也不调用付费 Provider。

生产任务使用 `backend-production` GitHub Environment，分支策略只允许 `main`。环境变量为 `BACKEND_DEPLOY_HOST`、`BACKEND_DEPLOY_USER`、`BACKEND_DEPLOY_PORT`；环境 Secrets 为专用的 `BACKEND_DEPLOY_SSH_KEY` 与固定服务器主机公钥的 `BACKEND_DEPLOY_KNOWN_HOSTS`。模型、Deepgram 等业务凭证仍只保存在服务器共享配置中。

专用公钥通过 OpenSSH `restrict,command="/usr/local/libexec/72-mvp-deploy"` 限制，只能发布此项目或查询版本，不能获取普通 SSH shell、PTY 或端口转发。服务器入口由 root 持有，源码见 [receive-server.sh](../../infra/deploy/receive-server.sh)；首次配置及修改入口时，由管理员用现有 SSH 连接安装该脚本，CI 本身不能替换它。

每次发布验证压缩包的 SHA-256、路径白名单、大小上限和提交/运行标识，再在新版本目录用锁文件安装生产依赖。准备完成后，原子切换 `current` 并重启单个服务；检查进程工作目录属于新版本、存活/就绪状态和本机 Nginx HTTPS。切换后的任何失败都会恢复上一版本并重启；若管理员已将 `current` 切到别处，旧任务不会覆盖新的指向。

Actions 对同一分支串行执行发布，服务器另有 `flock` 锁防止交叉切换。发布前再次确认提交仍是 `main` 最新版本；落后的运行会跳过，由新提交的运行接替。旧版本保留在 `releases/`，支持手动回滚；后端重启会使内存会话失效。

查询最新发布和手动运行：

```sh
gh workflow run backend.yml --repo konbluesky/72-mvp-homework --ref main
gh run list --repo konbluesky/72-mvp-homework --workflow backend.yml
ssh my-xin-2 'cat /home/ubuntu/work/72-mvp-homework/current/release.json'
```

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
