# 工程文档导航

当前实现为 Vue 3 + 独立 Node/Fastify + LangGraph；Live 语音使用 Deepgram STT/TTS，角色使用真实 Live2D/Haru 技术替身。文档围绕已实现的代码维护。

## 开发与运行

- [根 README](../README.md)：启动方式、交付状态和模块入口。
- [开发排错](development/README.md)、[VS Code 调试](development/vscode.md)：Node/npm、录音工具、端口与配置。
- [Provider 配置](provider-configuration.md)、[Provider 架构](architecture/providers.md)：能力组合、GPT/Deepgram/R2、离线与显式外部诊断。
- [版本控制范围](development/version-control.md)：源码与必要资产清单、排除规则、提交检查方式。

## 架构与契约

- [架构决策](architecture/decisions.md)：职责边界、轮次所有权、播放回执、取消与超时，以及当前 Live2D/Deepgram 选型。
- [HTTP/SSE/回执](contracts/README.md)、[生成的 OpenAPI](contracts/openapi.json)：共享 Zod schema 与真实路由是唯一协议来源。
- [部署与回滚](operations/README.md)、[反向代理示例](operations/nginx-production.conf)：Docker/Compose、CF Pages、单实例与 SSE。

## 资产与验证记录

- [素材来源](../assets/README.md)、[Live2D 来源与条款](../apps/web/public/assets/live2d/NOTICE.md)：必要运行资产及其来源、许可与哈希。
- [实施状态](acceptance/implementation-plan.md)、[Live2D 迁移验收](acceptance/live2d-migration.md)、[角色四态调整](acceptance/character-expressiveness.md)、[Deepgram 集成记录](acceptance/deepgram-integration.md)。
- [演示步骤](acceptance/demo.md)、[AI 协作记录](../AI_USAGE.md)。

验收文档中的既有结果记录对应当时执行，不表示每次整理都重新运行测试。真实模型、Haru 技术替身、原创 Mira 资产与真机听感是不同验证范围。

研究稿、旧 UI/Rive 设计、原始需求 PDF、探索原型、截图、录像和原始测试报告保留在本地，未纳入公开仓库；它们不是运行或构建依赖。新增设计提案不自动进入当前实现文档，纳入版本控制时需显式更新文件清单。
