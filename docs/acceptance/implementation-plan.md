# 实施状态与验收入口

> 2026-11-01：WebGAL 第 1–3 点持续会话改造见[交互说明](../architecture/webgal-interaction-design.md)；物件直接点选第 4 点仍待定，功能/运行时/E2E 未在本轮执行。
>
> 原版 `/` 与 WebGAL `/webgal.html` 按用户要求并存，原版仍为默认首页；以下 B0/Vue 描述保留为历史阶段记录。最新范围与验证边界见[八场景实施记录](miara-webgal-story.md)。

WebGAL 路线 B 已开始实施：[B0 迁移记录](webgal-migration.md)。固定引擎/parser 与 React 工作台进入构建；B1–B4 尚未交付，下表仍描述当前默认产品入口。

逐项跟进请使用[需求与代码对照 TODO 清单](todo-list.md)，其中保留勾选状态、代码证据、优先级与未完成项的验收条件；本页保留范围摘要。

当前工程已完成 npm workspaces 基座、共享协议、Vue/Fastify 独立入口、LangGraph 单轮编排、Mock 闭环、真实录音/播放、轮次取消及事件级回执。

| 范围       | 当前实现                                                 | 证据入口与边界                                                                                           |
| ---------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 工程与协议 | TypeScript/ESM、Zod、生成 OpenAPI、CI/Docker             | [开发](../development/README.md)、[契约](../contracts/README.md)                                         |
| 轮次与呈现 | 本地立即取消、服务端单轮所有权、冻结快照、独立超时       | [架构决策](../architecture/decisions.md)；测试源码随模块保存                                             |
| 角色       | 同源 Live2D/Cubism/Pixi，官方 Haru 技术替身              | [迁移验收](live2d-migration.md)、[四态调整](character-expressiveness.md)；原创 Mira 模型与专用手势待制作 |
| 语音服务   | 独立 STT/Planner/TTS 接口；Live 为 Deepgram/GPT/Deepgram | [集成记录](deepgram-integration.md)、[Provider 边界](../architecture/providers.md)                       |
| 部署       | 前后端独立构建、Compose、Pages/云服务器说明              | [部署与回滚](../operations/README.md)；公开生产环境需独立验证                                            |

既有验收结果对应各记录的执行时间。仓库发布整理不重跑功能、运行时或 E2E；本次范围与静态检查见[版本控制说明](../development/version-control.md)。真机听感、最终角色模型、真实供应商账户权限和生产网络不可由 Mock 或历史截图推断。
