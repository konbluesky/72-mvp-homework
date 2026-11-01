# 场景模块化

2026-11-01。复用现有 Ink、LangGraph、单轮播放与回执；保留并行会话的持续对话、推荐一键发送、语音预览及 explicit 动作复核。未手动启停或另起 dev 服务。

## 边界

| 模块                           | 职责                                                                 |
| ------------------------------ | -------------------------------------------------------------------- |
| server/scenario/cafe           | Ink、角色身份、Lore、公开投影、合法ID、Mock内容和音频索引            |
| server/scenario/runtime        | inkjs适配、存档父链、通用上下文与推荐校验；不认识咖啡馆地点/剧情事实 |
| web/webgal/scenes/cafe         | 本地资源、地点布局、热点锚点、前景、环境预设、呈现与旧Vue适配        |
| web/webgal/characters/profiles | 模型路径、参数与动作能力；Miara/Haru均保留和明确归属                 |
| 共享基础设施                   | 鉴权、容量、轮次、取消、播放队列、事件与回执、媒体和资源释放         |

后台组合入口 `scenario/index.ts` 显式选取默认故事，SessionManager必须注入场景实例。前端入口 `webgal/main.tsx` 将 `cafeSceneModule` 交给产品页面和InteractiveHost；产品壳不导入咖啡馆资源、呈现类或地点坐标。

本轮支持在组合入口替换故事包、在故事包内新增地点；未建设故事市场、远程代码插件或同进程多故事选择器。动作和事件类别仍是平台协议；内容ID由模块校验，而非无限制执行输入字符串。

## 内容与公开配置

`packages/protocol/src/story.ts` 仅约束有界ID、DTO与容量。地点、道具、结局、阶段与公开事实不再枚举咖啡馆内容。活动Ink包校验地点/环境/结局/资源成员；道具正文仍由后端Lore授权，不复制到前端。

manifest声明公开presentation、phaseLabels、资源绑定、环境变体及资源最低要求。`runtime/content-schema.ts` 为编译器与服务端加载提供同一份呈现/资源校验，公开投影只保留环境变体的 value；解锁条件 requires 留在服务端并核对已声明标记。`scenarios:build`发现scenario下有manifest的内容目录，编译Ink并生成前端 `manifest.generated.json`。该产物只含严格校验的公开呈现字段与资源引用，开场文字opening仅从后端声明的openingVoice中选取已公开的一句；不含Ink字节码、Lore正文、其他台词或完整语音目录、私有标记或存档。`scenarios:check`同时校验两个产物，前端与服务端场景ID/版本不匹配时拒绝混用。

隐藏内容仍留在服务端。编译器的EXTERNAL禁用、标签白名单、内容引用校验和预算继续保留。默认故事名称可以出现在组合入口和故事包中，不能在通用运行时内兜底。

## 地点与角色

每个 `cafe/locations/<id>.ts` 聚合背景、人物锚点、热点、窗方向与可选前景处理器；复杂绘制保留本地TypeScript，不塞入Ink或任意JSON脚本。注册表校验公开地点ID与渲染配置一致。室外/关闭背景变体通过地点配置确定，不在产品壳维护平行名单。

角色运行时保留单一更新链、口型、取消与销毁；profiles保存模型差异并直接向产品页提供名称与归属。咖啡馆配置Miara需要隐藏的样例部件，地点声明望窗方向。Haru默认、Miara显式可选，没有添加静默替换或旧SVG/Rive回退。

旧Vue页通过 `LegacySceneModule` 接收公开内容、环境标签、照片和背景组件；只有 `app/main.ts` 选择 café 兼容模块。咖啡馆文案与雨窗样式位于 `cafe/legacy.ts` 和 `LegacyBackdrop.vue`，通用 `App.vue` 与 `CharacterStage.vue` 不导入具体故事。已移除旧 `scene/presentation.ts` 转发。标准舞台坐标系、受控图片/环境事件和既有四态/表演动作仍可共享。

清理移除了无调用方的 `sceneActionAnchor` 与呈现类 `previewMotion` 包装；产品页仍通过地点 anchors 和宿主角色驱动执行既有功能。会话错误与通用菜单不再固定使用咖啡馆/夜晚文案；所有场景包的 compiled.json 均由 Git 与格式化工具忽略。

## 新增一个地点

1. 在cafe Ink中声明地点、可达选择、回访与剧情条件；更新manifest的地点目录。
2. 将背景及来源/哈希加入该故事资源清单。
3. 新建locations文件，在cafe渲染注册表中登记布局、热点和需要的前景。
4. 运行 `npm run scenarios:build`，随后做类型、lint、构建、资源与契约校验。

不需要修改SessionManager、PlaybackScheduler、产品页面JSX或共享协议的地点枚举。新增真正的平台事件类别或渲染能力仍需要显式演进相应接口。

## 验证状态

已补新地点/第五阶段/非照片事实的Ink适配用例、候选checkpoint隔离与重复提交拒绝、未声明内容拒绝，以及场景布局/资源绑定用例。遵守AGENTS，本轮未执行功能、E2E或运行时测试，未运行付费Provider探测。人物视觉与真机效果未重新验收。

静态门禁已通过：`npm run typecheck`、`npm run lint`、`npm run build`、`npm run scenarios:check`、`npm run assets:check`、`npm run contracts:generate` / `contracts:check`，以及WebGAL来源/边界校验。资源校验确认29条Live2D来源哈希、8张独立背景与11个场景文件。新增用例未执行；不把静态检查视为运行或真机验收。

## 2026-11-01 清理验证

本次通过项目启动器使用 Node 26.13.0 / npm 11.20.0，实际通过 typecheck、lint、build、scenarios:build / scenarios:check、assets:check、contracts:check、webgal:check、修改文件的 Prettier 检查及 git diff --check。协议源码未修改，无需重新生成 OpenAPI。场景编译为 10 个 Ink 文件、0 条诊断；资源结果仍为 29 条 Live2D 哈希、8 张背景和 11 个场景文件。

新增 `runtime/content-schema.test.ts` 覆盖环境解锁条件不进入公开投影、拒绝未声明字段和保留标识符，按 AGENTS 未执行。功能、运行时、E2E 与人物真机视觉仍未重新验收。构建保留 WebGAL 部分 bundle 超过 500 kB 的既有提示，本轮不扩展到拆包重构。未启停开发服务、调用付费 Provider、暂存或提交；原有其他会话改动保留。

## 平台名称与全应用边界审查

应用名称为“角色互动平台”。HTML 标题/描述、两个页面的品牌、引擎预览、API 文档及根 npm 项目名均使用平台名称。场景元数据改用中性的“咖啡馆”说明，页面不再显示历史剧情名或对应副标题。历史 npm scope `@mira/*` 与启动环境变量是兼容标识，不作为角色身份或剧情配置。本次不改动这些已有依赖与启动接口。

生产代码中的故事身份、台词、事实键、资源绑定与咖啡馆样式归场景模块；组合入口只选择模块。Live2D profiles 中的 Haru/Miara 名称、模型文件和归属属于渲染资产配置。photo/environment、动作枚举、回执和场景 DTO 属于平台能力，不声明具体剧情事实。测试 fixtures、素材来源、场景素材生成器和显式选择示例包的诊断脚本可以引用示例内容，它们不构成生产业务路由。

新增 `npm run modules:check`，静态检查生产源码的跨应用/具体场景导入、从场景清单派生的内容标记及三个 HTML 入口的名称，并接入 CI 的既有 check 流程。API 客户端在创建会话和每次恢复快照时校验模块 ID/版本，阻止不兼容投影进入 Vue/WebGAL 状态。舞台恢复错误也检查呈现实例与生命周期，旧舞台的迟到失败不能覆盖重建后的状态。对应的 API 边界与舞台竞态测试源码已补，按 AGENTS 不执行。

资源审查补齐根公开资产来源清单、公开资源库存/哈希/本地引用，以及场景声明的全部离线 WAV 哈希、PCM 文件头、时长/采样率和台词绑定。`assets:check` 不挂载页面、不播放音频、不调用 Provider。演示脚本已按当前 conversation 入口和 presentation.ready 回执修正源码；未执行录屏或 smoke。

纯资源索引拆入 `cafe/resources.ts`，旧 Vue 页查询照片时不再导入地点注册表及 Pixi 前景代码。公开资源按工作区最终版本核对，包含并行会话完成的 WebP 背景替换；不覆盖其他会话的资产或来源改动。

本次实际通过：typecheck、lint、全仓 format:check、build、modules:check、assets:check、scenarios:build / scenarios:check、contracts:generate / contracts:check、webgal:check 及 git diff --check。模块检查覆盖 95 个生产源码文件；公开资产核对 44 条来源哈希、29 处本地引用，另核对 18 条离线 WAV。构建保留约 701 kB 的 WebGAL chunk 体积提示。API/舞台回归测试、功能、运行时、E2E、真实语音与人物视觉未在本轮执行；未启停服务、暂存或提交。
