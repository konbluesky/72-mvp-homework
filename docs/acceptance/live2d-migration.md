# Live2D 二次元舞台改造验收

日期：2026-10-31（Asia/Shanghai）。本次按用户选定的二次元探索方向（本地留存）将真实 Live2D 接入主项目。此前 工程基座验收（本地留存） 保留为历史记录，不用旧的 SVG 截图证明此次改造。

## 范围与事实边界

沿用 Vue、Fastify、LangGraph、私有媒体、单一 PlaybackScheduler 与回执链路。角色渲染改为 Cubism + Pixi 实际 `.moc3` 和纹理，环境由独立背景、雨、光照层表现。普通页面不包含探索用的调参面板。

当前资源是官方 Haru 技术替身；原创成年 Mira 的服装、身份模型和专用递照片手势仍需正式资产。参数驱动的轻微身体姿态与 DOM 照片呈现不宣称为专用递照片绑定。代码许可不自动覆盖 Cubism Core 与角色素材，来源、哈希及官方许可随部署资源保留。

本次不配置或调用付费 Provider。声音只由已有 Web Audio 调度器播放，模型没有第二条音轨；嘴部驱动来自播放器实际测得的音频能量。加载失败时保留输入与场景，明确降级并提供重试，不能恢复旧 SVG 角色后称 Live2D 成功。

## 验证计划与结果

| 边界       | 验证                                                                                                            | 当前证据                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 真实渲染   | 在浏览器原生 WebGL draw 后抽样 framebuffer，断言非透明且存在多色像素；模型与两张纹理均从本地加载                | 定向浏览器验收通过                                        |
| 三种情绪   | reduced motion 下发送三类对话，实际声音开始后打断，比较真实 canvas 光栅，不只检查状态标签                       | 定向浏览器验收通过                                        |
| 声音与打断 | 包装原生 AnalyserNode 观测非零 RMS；打断后音频采样停止但角色仍由独立受控 ticker 渲染                            | 定向浏览器验收通过                                        |
| 失败与恢复 | 阻断 `.moc3` 下载；输入和音频仍可用；解除阻断后重试成功。另用真实 `WEBGL_lose_context` 扩展触发上下文丢失并重试 | 定向浏览器验收通过                                        |
| 旧加载隔离 | 挂起第一轮模型请求，模拟 visibilitychange→隐藏→恢复，只允许新加载呈现；释放旧请求不能覆盖新实例                 | 定向浏览器验收通过                                        |
| 后台停止   | 模拟 document.hidden 后检查原生 WebGL draw 不再发生；恢复后重新建立有效实例                                     | 定向浏览器验收通过                                        |
| 资源与缓存 | renderer 单测验证迟到加载、取消、重试、纹理/Blob URL/RAF/observer/事件监听释放与所有权                          | 统一check通过，包含16项runtime与5项Vue生命周期测试        |
| 移动布局   | DPR=3 下测试320/390/1440尺寸，无水平溢出、麦克风热区在视口内、canvas backing DPR不超过1.5                       | 定向浏览器验收通过                                        |
| 原有业务   | 重新执行现有文字/语音、照片事实、音频降级、断网恢复与快速三轮E2E                                                | Docker演示上的原7项+新增4项全通过，11/11，45.6秒          |
| 删除旧实现 | 成功后扫描应用源码与依赖，确认旧 SceneArt、SVG人物动画、Rive分支/配置/依赖不再存在                              | 已完成；应用源码、前端package与根lockfile扫描无旧实现引用 |

新跨应用测试位于 `tests/e2e/live2d.spec.ts`。测试中的 WebGL/Audio hooks 和 visibility 模拟只存在于 Playwright 页面，不向产品增加 debug globals 或调试按钮。

## 必须保留的限制

浏览器移动尺寸与 DPR 仿真不是真实 iOS/Android 设备；visibility 竞态由可控页面属性/事件触发，不证明 OS 后台策略。WebGL 丢失使用浏览器扩展模拟，不是物理显卡故障。未测真实手机 FPS、发热或 GPU 内存，不把30 FPS配置上限当作实测性能。

用户人工试听、真实 Provider、原创 Mira 模型及专用手势没有在本轮被证明。旧探索原型、原设计和历史验收资料保留以便追溯；清理对象是主应用中被替代的运行代码与依赖。

## 本次独立复核记录

- `npx playwright test tests/e2e/live2d.spec.ts --reporter=list`：4项通过，15.9秒；随后改进高DPR截图方法，对修正版第4项独立复跑通过，10.6秒。最终完整套件由主agent统一执行，避免多个浏览器进程覆盖同名证据。
- `npx tsc -p tsconfig.tools.json`、定向ESLint通过，测试不引入生产debug入口。
- 390px截图（本地留存）、320px截图（本地留存）、桌面截图（本地留存）经视觉复核，人物居中、输入可见。高DPR测试明确断言 `innerWidth` 等于目标宽度、devicePixelRatio=3及canvas实际backing比例≤1.5。
- 删除旧 `SceneArt.vue`、原`character.test.ts`、`rive.ts`及`rive-lifecycle.test.ts`，移除`createSvgRenderer`、`VITE_RIVE_SRC`和`@rive-app/webgl2`依赖/锁记录。图标和独立旅行照片仍可使用SVG，它们不是被替代的人物拼片。

复核实际发现并修复：旧wrapper的URL解析会把 `blob:http://...` 改写成无效地址，导致模型网络加载失败；在公开 `Cubism4ModelSettings.resolveURL` 边界按受控Blob白名单原样返回后真实渲染恢复。资源取消时的reader lock与SDK未settle情况下的独占纹理/Blob清理也补入测试。

另外，最初直接CDP覆盖viewport与Playwright全页截图的viewport管理冲突，产生了被裁切的截图；改为Playwright context的deviceScaleFactor配置与标准setViewportSize，并补精确宽度断言后重新截图。该问题属于测试证据采集，未将错误截图当作最终移动端验收。

## 最终统一门禁

- `npm ci`：Node26.13.0/npm11.20.0清洁安装354包通过。首次遇到npm删除依赖目录的ENOTEMPTY，停止并确认无安装进程后重试成功，未修改锁文件规避问题。
- `npm run check`：typecheck、ESLint、Prettier通过；21个Vitest文件/146项测试、4项Node运行时测试通过；21项Live2D资源SHA-256与manifest引用校验通过。历史场景调研文档保留原格式，不作为新代码格式门禁。
- `npm run build`：protocol/server/web全部通过。前端主JS198.94kB（gzip66.56kB），Live2D适配chunk9.83kB；vendor与模型同源静态资源另计，未把它们藏在bundle体积之外冒充总下载大小。
- `npm run contracts:check`：共享协议和OpenAPI一致，未改后端业务协议。
- `E2E_BASE_URL=http://localhost:8080 npm run test:e2e`：直接通过Docker nginx/API运行11项全部通过，45.6秒；不绕过浏览器自动播放策略。测试启动期间仅临时提高会话创建限额，完成后恢复普通Compose默认配置。
- `docker compose --profile demo build`、`up -d --wait`：构建/启动通过，API健康，演示继续运行于http://localhost:8080。
- `npm run smoke:demo`：SSE在EOF前下发、两段497494字节WAV、照片/环境回执、跨会话媒体拒绝通过。
- 所有21项发布资源在生产dist中的SHA-256与来源清单一致；Rive依赖/锁条目/配置入口和旧人物实现扫描无残留。

真实Chrome使用agent-browser-cli检查生产页面 `data-renderer=live2d`、旧人物SVG不存在、当前Haru说明可见；生产截图（本地留存）。移动布局与实际绘制证据见上方截图。

新版主项目已实际录制自动演示视频（本地留存），包含真实Live2D、语音/照片/打断、字幕降级与照片失败恢复。录制脚本186秒，系统声音未录制，麦克风为测试设备；抽帧检查（本地留存）与机器可读证据（本地留存）可复查。

原始截图、录像与机器证据仅本地留存，未纳入公开仓库；此处为既有执行摘要，本次版本控制整理未重新执行这些测试。
