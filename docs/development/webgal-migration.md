# WebGAL 路线 B 开发入口

> 两页并存：默认 `/` 与 `/webgal.html` 为 WebGAL 故事页，`/legacy.html` 为原版 Vue/Haru 页面。两页均默认 Haru，WebGAL 保留 Miara 显式切换。页面版本不决定 Provider；都使用当前后端 APP_MODE。以下 B0 内容保留为历史阶段记录，当前实现见[八场景实施记录](../acceptance/miara-webgal-story.md)。

本次选择完整 WebGAL/React 宿主，保留 Backend、TurnController 与 PlaybackScheduler 的编排核心。引擎负责舞台执行；Scheduler 保持声音、字幕、演出启动及呈现结果的唯一调度权。场景与角色通过端口注入，基础层不导入具体咖啡馆/Haru 实现。

## 当前入口（B0）

使用项目固定的 Node 26.13.0 / npm 11.20.0：

```sh
node scripts/project.mjs ci
npm run dev
```

- 当前产品：[http://localhost:5173/](http://localhost:5173/)。迁移期间保留既有页面。
- React/WebGAL 场景演示：[http://localhost:5173/webgal.html](http://localhost:5173/webgal.html)。首页顶部“WebGAL 演示”也可进入；同一 Vite 服务，单独 HTML 入口。

工作台现在包含“雨夜咖啡馆”和“雨后的傍晚”两个本项目内置示例。背景由 WebGAL StageStateManager 原生同步至 PixiStage，雨滴使用未改动的原生 rain 特效，镜头使用原生 transform。可以开关雨效、切换背景、缩放和重建；侧栏读取实际背景对象、粒子、提交次数和 stageEpoch。

这仍是 B0 引擎能力样板，未连接对话、录音、Haru 或业务回执。场景自绘 SVG 不是上游 demo 剧本；原生 story 自动推进继续关闭。按用户最新要求，原版与 WebGAL 两页长期并存；迁移完成也不删除原版 UI 或其 Vue/Pinia 依赖，不自动更换首页。

如果服务在依赖安装或迁移配置更新前就已启动，首次打开工作台可能遇到 `Outdated Optimize Dep` 或旧别名解析错误。先让 Vite 重载当前配置，仍未恢复时通过 VS Code 停止并重新启动该开发任务，再刷新页面；不要通过移除别名或回退旧渲染器处理。

## 目录与边界

| 路径                                            | 用途                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `apps/web/src/engine/webgal/`                   | 固定上游提交的完整引擎源码与本地 host mode 扩展                  |
| `apps/web/third-party/webgal/`                  | MPL、原始 manifest、逐文件 SHA-256、本地补丁原因                 |
| `packages/webgal-parser/`                       | 同提交 parser 的 npm workspace；自身版本 4.6.5                   |
| `apps/web/src/webgal/`                          | 迁移期 React 壳与通用引擎生命周期；后续并入正式 app/runtime 目录 |
| `apps/web/src/webgal/runtime/bootstrap.ts`      | 先配置 interactive，再动态导入 Core                              |
| `apps/web/src/webgal/runtime/engine-adapter.ts` | 单一 stage lease、epoch、resize、卸载与 GPU/DOM 清理             |

初始化 attempt 与 stage lease 分开：同一次初始化复用 promise；取消同步失效旧 attempt；迟到的 factory 结果只销毁自己的 lease。模式在页面生命周期内锁定。原生 bootstrap/next/forward/auto/fast/runScript 在 interactive 下受控拒绝。此为 B0 的入口防护；不等于 B2 的媒体入口、perform、资源与动画作用域治理已经完成。

可见示例定义在 `src/webgal/scenes/engine-demo/`，通过 `composition.ts` 注入；`runtime/native-visuals.ts` 不导入场景实现。预览端口只接受本地注册资源 ID、有限原生效果和 1–1.2 范围缩放。每个异步资源就绪和绘制回调检查 stage owner 与 scene revision；销毁停止原生雨 ticker/容器，移除等待帧，并 detach AssetManager 的旧 renderer。两个背景与一张雨纹理是有界的页面缓存，舞台重建复用素材；这不是后续任意业务资源的完整作用域实现。

同一根锁文件固定 React/ReactDOM 18.3.1、Pixi 6.5.10 和 `pixi-live2d-display-webgal` 0.5.19。React 18 同时满足引擎和现有 LangGraph SDK 的 peer 范围；根 tooling pins 和 overrides 保证只有一套版本。没有使用 `--force` 或 `--legacy-peer-deps`。

parser 先于 web 构建；Docker 构建阶段也包含其 workspace manifest 与源码。`build:server` 仍可独立构建，不引用前端引擎。新增 workspace 时需保持两个 Dockerfile 的 manifest 安装层一致。

## 静态验证与后续迁移

```sh
node scripts/project.mjs typecheck
node scripts/project.mjs lint
node scripts/project.mjs build
node scripts/project.mjs contracts:check
node scripts/project.mjs assets:check
node scripts/project.mjs webgal:check
```

`webgal:check` 校验原始源码/补丁哈希、单套渲染依赖与基础层 import 边界，不启动浏览器或引擎。上游源码保留原始格式，不套用本工程 lint/format 规则；仍完整进入严格 TypeScript 检查。自有宿主代码继续 lint/format。

按 `AGENTS.md`，开发中不运行功能、E2E 或运行时测试，除非用户明确请求；不要为验证本阶段直接运行含测试的 `npm run check`。新增生命周期竞态用例已保存为测试源码，执行状态见[迁移记录](../acceptance/webgal-migration.md)。

下一阶段 B1：抽离 Pinia 投影，建立 headless InteractiveState/端口，迁 React 输入与字幕，复用 HTTP/POST SSE/录音/回执链。随后 B2 接 Bridge/ScopedExecutor/呈现事务，B3 迁同源 Cubism4/Haru 和场景，B4 做经授权的运行验证与交付。完整迁移前不把编译通过当作实际演出与打断验收。
