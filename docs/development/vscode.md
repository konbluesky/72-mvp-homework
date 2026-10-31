# VS Code 一键启动前后端

打开仓库根目录，选择 **Mira: 一键启动前后端**，按 **F5**。API 和 Vite 启动、页面与 API/代理都就绪后自动打开 Chrome。停止使用调试工具栏或 `Shift+F5`。

## 运行时自动选择

启动器读取 `.nvmrc` 与 packageManager，自动选择 **Node 26.13.0 / npm 11.20.0**，并将该运行时传给后续 npm、tsx、Vite 子进程。

即使 VS Code 继承系统 Node 26.5，也不再因此阻塞。**无需重启 VS Code、切换系统默认 Node 或写死个人路径。** 本机已安装对应 nvm 版本；新机器先执行一次：

```sh
nvm install 26.13.0
node scripts/project.mjs ci
```

非 nvm 安装可通过 `MIRA_NODE_PATH` 指定对应 Node 可执行文件。`node scripts/project.mjs runtime` 显示项目实际使用的版本；普通 `node --version` 仍可能显示系统版本，这是正常的。

终端启动也使用相同逻辑：`npm run dev`。其他检查可用 `node scripts/project.mjs check`、`node scripts/project.mjs build`，避免系统 npm 版本影响。

## 业务配置

- 只编辑后端 `apps/server/.env`，参考 [最小模板](../../.env.example)。真实密钥不进入前端或 launch.json。
- 前端 `apps/web/.env.local` 中 VITE_API_BASE_URL 留空即使用本地代理。
- APP_MODE=mock 无需凭证；APP_MODE=live 使用已配置的 GPT 和 Deepgram，不自动降级 Mock。
- Live文字/录音均可使用，同一Deepgram key负责识别和合成；Mock明确模拟转录。
- 部署、R2、限额和超时由代码提供默认值，只有需要覆盖时才使用 [高级模板](../../.env.advanced.example)。

详见 [Provider 配置](../provider-configuration.md)。所有 F5 本地启动都会同步覆盖本地端口、代理、CORS，并清空前端远端 API 地址；业务 Provider 设置仍从后端 `.env` 读取。

修改后端 `.env` 后，停止当前调试再按 F5；已创建的 Provider 不会仅因配置文件保存就自动替换。项目只读取 `apps/server/.env`，根目录旧配置的迁移备份不参与加载。

## 启动与调试链路

`F5 / npm run dev → 选择项目运行时 → 构建 protocol → concurrently 启动 API tsx watch + Vite → 等待就绪 → 打开 Chrome`。

后端断点位于 `apps/server/src`，前端断点位于 `apps/web/src`。Node 子进程自动附加已启用，前端支持 HMR；共享协议修改后需重启/重新构建，并按仓库规则更新 OpenAPI。

启动器只向本次启动的子进程树传递停止信号，不使用 pkill，并保留普通进程组关系以兼容 IDE/测试工具的强制停止。复合调试的 stopAll 同时停止服务与 Chrome。

## 端口与排错

[settings.json](../../.vscode/settings.json) 只保留 `mira.apiPort` 和 `mira.webPort`，默认为 3000/5173。修改后，启动、代理、CORS、浏览器 URL 和健康检查同步变化。

端口已占用时先正常停止旧实例或修改端口；预检不会杀掉已有进程。60 秒未就绪请查看服务终端，不要选择“仍然调试”跳过错误。录音需要 FFmpeg，文字输入不需要；麦克风与首次发声仍需浏览器授权/用户手势。

## 文件职责

| 文件                                     | 职责                               |
| ---------------------------------------- | ---------------------------------- |
| [launch.json](../../.vscode/launch.json) | 唯一的前后端 + Chrome 复合入口     |
| [tasks.json](../../.vscode/tasks.json)   | 预检、就绪、安装依赖、检查与构建   |
| [project.mjs](../../scripts/project.mjs) | 执行项目命令、清理本次子进程树     |
| [runtime.mjs](../../scripts/runtime.mjs) | 定位精确 Node/npm，设置子进程 PATH |
| [dev.mjs](../../.vscode/scripts/dev.mjs) | 端口与健康检查，不读取密钥         |

参考 KissMe 的集中启动入口，但不引入 Python、frp、登录脚本或个人浏览器目录。启动就绪不代表所有三方能力或真机已经验收。
