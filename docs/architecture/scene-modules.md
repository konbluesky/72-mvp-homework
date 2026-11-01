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

manifest声明公开presentation、phaseLabels、资源绑定、环境变体及资源最低要求。`scenarios:build`发现scenario下有manifest的内容目录，编译Ink并生成前端 `manifest.generated.json`。该产物只含严格校验的公开呈现字段与资源引用，不含Ink字节码、Lore正文、语音台词、私有标记或存档。`scenarios:check`同时校验两个产物，前端与服务端场景ID/版本不匹配时拒绝混用。

隐藏内容仍留在服务端。编译器的EXTERNAL禁用、标签白名单、内容引用校验和预算继续保留。默认故事名称可以出现在组合入口和故事包中，不能在通用运行时内兜底。

## 地点与角色

每个 `cafe/locations/<id>.ts` 聚合背景、人物锚点、热点、窗方向与可选前景处理器；复杂绘制保留本地TypeScript，不塞入Ink或任意JSON脚本。注册表校验公开地点ID与渲染配置一致。室外/关闭背景变体通过地点配置确定，不在产品壳维护平行名单。

角色运行时保留单一更新链、口型、取消与销毁；profiles保存模型差异。咖啡馆配置Miara需要隐藏的样例部件，地点声明望窗方向。Haru保留为显式可选角色，没有添加静默替换或旧SVG/Rive回退。

旧Vue页通过 `cafe/legacy-presentation.ts` 明确使用咖啡馆兼容适配，旧导入路径只保留转发。标准舞台坐标系、受控图片/环境事件和既有四态/表演动作仍可共享。

## 新增一个地点

1. 在cafe Ink中声明地点、可达选择、回访与剧情条件；更新manifest的地点目录。
2. 将背景及来源/哈希加入该故事资源清单。
3. 新建locations文件，在cafe渲染注册表中登记布局、热点和需要的前景。
4. 运行 `npm run scenarios:build`，随后做类型、lint、构建、资源与契约校验。

不需要修改SessionManager、PlaybackScheduler、产品页面JSX或共享协议的地点枚举。新增真正的平台事件类别或渲染能力仍需要显式演进相应接口。

## 验证状态

已补新地点/第五阶段/非照片事实的Ink适配用例、候选checkpoint隔离与重复提交拒绝、未声明内容拒绝，以及场景布局/资源绑定用例。遵守AGENTS，本轮未执行功能、E2E或运行时测试，未运行付费Provider探测。人物视觉与真机效果未重新验收。

静态门禁已通过：`npm run typecheck`、`npm run lint`、`npm run build`、`npm run scenarios:check`、`npm run assets:check`、`npm run contracts:generate` / `contracts:check`。资源校验确认29条Live2D来源哈希、8张独立背景与11个场景文件。新增用例未执行；不把静态检查视为运行或真机验收。
