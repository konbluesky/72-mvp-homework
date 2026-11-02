# 实施状态与验收入口

> 2026-11-02：修复线上场景版本不同步的发布阻塞：接收白名单精确允许图片分享包的两个资产文件及父目录，并记录服务器安装脚本的同步要求。创建会话新增 expectedScenario，版本不兼容在分配或替换会话前返回 409；两个入口单独显示“刷新页面”，保留恢复凭证、草稿和回看。已补创建/替换容量保护、协议字段和两入口恢复回归源码；通过 typecheck、修改源码 ESLint、生产构建、modules:check、scenarios:check、contracts:generate/check、格式及 shell 语法检查。遵守 AGENTS，本地未执行功能、运行时或 E2E 测试，未调用付费 Provider；生产发布另核对场景版本和存活/就绪状态。

> 2026-11-01：已实施角色主动纪念照的协议 v4、回执后后台生成、ComfyUI 直连/私有图片、受限媒体展示轮次、两入口共用卡片与恢复协调器。Mock 无密钥使用明确模拟图/字幕，确定失败最多一次手动重新准备。新增生命周期/竞态与原生传输测试源码；本轮只进行静态检查，未执行功能、运行时、E2E、浏览器交互或真实出图验收。节点只读发现仅证明所需节点/checkpoint 存在。实际边界见[图片分享架构](../architecture/image-sharing.md)。

> 2026-11-01：会话默认改为不按时间过期（SESSION_TTL_SECONDS=0、expiresAt=null），刷新、离开页面和断网保留现有会话；明确重新开始才鉴权替换并释放旧会话名额，网络失败后的替换意图跨刷新保留。后端仍只存内存，服务重启/故事版本不兼容和已失效旧会话不在恢复范围。通过 typecheck、修改源码 ESLint、生产构建、modules:check、contracts:generate/check、格式及差异空白检查；构建保留既有大包提示。已补长期保留、有限时长兼容、容量复用、鉴权、重开失败、旧取消隔离及跨刷新重开测试源码，遵守 AGENTS 未执行功能、运行时或 E2E 测试，未手动启停服务。策略见 [ADR 014](../architecture/decisions.md#adr-014--默认保留会话显式重新开始才替换)。

> 2026-11-01：修复失效会话提示的直接操作：原版和 WebGAL 在会话失效时就地显示“重新开始”，无需进入菜单；网络、超时及 5xx 保留“重新连接”，音频错误保留声音重试/文字入口。失效提示不随通用错误关闭而消失；单轮取消文案改为重新发送消息，避免混淆会话重开。补充两入口断网、502/503、请求超时与旧 410 迟到的分类回归源码，按 AGENTS 约束未执行功能、运行时或 E2E 测试。

> 2026-11-01：两个入口已接入消息级失败状态和原气泡重试。重试保留 messageId、更换执行身份，先同步回执和快照；完全未回应的失败输入不进入已确认历史。部分呈现、主动打断、音频播放失败和会话过期分别处理。已通过 typecheck、生产构建、修改源码 ESLint、modules:check、contracts:generate/check 与差异空白检查；新增失败/重试、回执完成、刷新恢复和旧回调隔离测试源码，遵守仓库限制未运行功能、运行时或 E2E 测试，也未调用付费供应商或手动启停服务。协议与交互细节见[契约](../contracts/README.md#失败)及[交互说明](../architecture/webgal-interaction-design.md#演出与并发)。

> 2026-11-01：原版与 WebGAL 已接入浏览器侧草稿、有限回看、偏好和有效期内会话恢复；不保存录音或本地剧情事实，服务失效后保留记录并要求明确重新开始。Node 26.13.0 / npm 11.20.0 下通过 typecheck、lint、build、modules:check、contracts:generate/check；构建保留既有大包提示。已补恢复/回执/过期/迟到响应测试源码，本轮未执行功能、运行时、E2E 或浏览器交互验证，未启动或重启服务。设计与凭证策略见 [ADR 013](../architecture/decisions.md#adr-013--浏览器侧保存与短期会话恢复)。
>
> 2026-11-01：顶栏双向切换、回看样式、推荐动作绑定与前景贴图已修复；已使用 agent-browser-cli 顺着推荐走到离店结局，自动化功能/运行时/E2E 未执行。记录见[交互说明](../architecture/webgal-interaction-design.md)。
>
> 之前 WebGAL 第 1–3 点持续会话改造见[交互说明](../architecture/webgal-interaction-design.md)；物件直接点选第 4 点仍待定，功能/运行时/E2E 未在本轮执行。
>
> 原版 `/` 与 WebGAL `/webgal.html` 按用户要求并存，原版仍为默认首页；以下 B0/Vue 描述保留为历史阶段记录。最新范围与验证边界见[八场景实施记录](miara-webgal-story.md)。

WebGAL 路线 B 已开始实施：[B0 迁移记录](webgal-migration.md)。固定引擎/parser 与 React 工作台进入构建；B1–B4 尚未交付，下表仍描述当前默认产品入口。

逐项跟进请使用[需求与代码对照 TODO 清单](todo-list.md)，按需求 PDF 的原章节、原顺序、原条目勾选并说明当前状态；本页保留范围摘要。

当前工程已完成 npm workspaces 基座、共享协议、Vue/Fastify 独立入口、LangGraph 单轮编排、Mock 闭环、真实录音/播放、轮次取消及事件级回执。

| 范围       | 当前实现                                                 | 证据入口与边界                                                                                           |
| ---------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 工程与协议 | TypeScript/ESM、Zod、生成 OpenAPI、CI/Docker             | [开发](../development/README.md)、[契约](../contracts/README.md)                                         |
| 轮次与呈现 | 本地立即取消、服务端单轮所有权、冻结快照、独立超时       | [架构决策](../architecture/decisions.md)；测试源码随模块保存                                             |
| 角色       | 同源 Live2D/Cubism/Pixi，官方 Haru 技术替身              | [迁移验收](live2d-migration.md)、[四态调整](character-expressiveness.md)；原创 Mira 模型与专用手势待制作 |
| 语音服务   | 独立 STT/Planner/TTS 接口；Live 为 Deepgram/GPT/Deepgram | [集成记录](deepgram-integration.md)、[Provider 边界](../architecture/providers.md)                       |
| 部署       | 前后端独立构建、Compose、Pages/云服务器说明              | [部署与回滚](../operations/README.md)；公开生产环境需独立验证                                            |

既有验收结果对应各记录的执行时间。仓库发布整理不重跑功能、运行时或 E2E；本次范围与静态检查见[版本控制说明](../development/version-control.md)。真机听感、最终角色模型、真实供应商账户权限和生产网络不可由 Mock 或历史截图推断。
