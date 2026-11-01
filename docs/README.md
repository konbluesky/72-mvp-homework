# 工程文档导航

当前保留两个并存入口：默认 `/` 为原版 Vue/Haru 对话页，`/webgal.html` 为 React/WebGAL 故事页（Haru 默认、Miara 显式可选）。二者共用独立 Node/Fastify + LangGraph。Live 继续 Deepgram STT/TTS，样例角色均明确归属。

## 开发与运行

- [WebGAL 交互与信息层级](architecture/webgal-interaction-design.md)：持续会话、推荐一键发言、角色引导与服务端动作确认；物件点选方案仍待定，含静态验证边界。

- [WebGAL 路线 B 开发入口](development/webgal-migration.md)、[迁移状态](acceptance/webgal-migration.md)：保留 B0 历史记录；新默认产品的当前进度见[八场景实施记录](acceptance/miara-webgal-story.md)。

- [根 README](../README.md)：启动方式、交付状态和模块入口。
- [开发排错](development/README.md)、[VS Code 调试](development/vscode.md)：Node/npm、录音工具、端口与配置。
- [Provider 配置](provider-configuration.md)、[Provider 架构](architecture/providers.md)：能力组合、GPT/Deepgram/R2、离线与显式外部诊断。
- [版本控制范围](development/version-control.md)：源码与必要资产清单、排除规则、提交检查方式。

## 架构与契约

- [轻量剧情控制设计](architecture/narrative-runtime-design.md)：设计与实现说明，复用scenario目录组织Ink故事包，借鉴SillyTavern的角色/Lore与软联动推荐；当前结果见[Ink接入记录](acceptance/narrative-ink.md)。
- [架构决策](architecture/decisions.md)：职责边界、轮次所有权、播放回执、取消与超时，以及当前 Live2D/Deepgram 选型。
- [HTTP/SSE/回执](contracts/README.md)、[生成的 OpenAPI](contracts/openapi.json)：共享 Zod schema 与真实路由是唯一协议来源。
- [连接监测与自动恢复](operations/connection-health.md)：HTTP/SSE 心跳、RTT、自动重连、会话恢复与不重播边界。
- [部署与回滚](operations/README.md)、[反向代理示例](operations/nginx-production.conf)：Docker/Compose、CF Pages、单实例与 SSE。

## 资产与验证记录

- [需求与代码对照 TODO 清单](acceptance/todo-list.md)：按原始需求与当前工程结构逐项勾选，区分代码实现、实际验收、交付缺口与可选扩展。
- [素材来源](../assets/README.md)、[Live2D 来源与条款](../apps/web/public/assets/live2d/NOTICE.md)：必要运行资产及其来源、许可与哈希。
- [Miara 资源说明](../apps/web/public/assets/live2d/miara/README.md)、[Miara + WebGAL 实施 prompt](prompts/miara-webgal-implementation.md)：模型、聊天、自定义参数动作与八场景已接入；Haru 保留并可显式切换。
- [Miara + WebGAL 八场景叙事方案](miara-webgal-scenario-design.md)：《雨停之前：最后一盏灯》v0.2，设计八个独立背景、三幕三结局、线索与回访，以及导航/道具/环境的契约增量；这是设计依据；已实现范围与未验证边界以[八场景实施记录](acceptance/miara-webgal-story.md)为准。
- [实施状态](acceptance/implementation-plan.md)、[Live2D 迁移验收](acceptance/live2d-migration.md)、[角色四态调整](acceptance/character-expressiveness.md)、[Deepgram 集成记录](acceptance/deepgram-integration.md)。
- [演示步骤](acceptance/demo.md)、[AI 协作记录](../AI_USAGE.md)。

验收文档中的既有结果记录对应当时执行，不表示每次整理都重新运行测试。真实模型、Haru 技术替身、原创 Mira 资产与真机听感是不同验证范围。

研究稿、旧 UI/Rive 设计、原始需求 PDF、探索原型、截图、录像和原始测试报告保留在本地，未纳入公开仓库；它们不是运行或构建依赖。新增设计提案不自动进入当前实现文档，纳入版本控制时需显式更新文件清单。

[场景模块边界](architecture/scene-modules.md)：故事包、地点呈现、角色profiles、公开manifest生成，以及新增地点需要修改的范围。
