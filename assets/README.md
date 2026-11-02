# 素材来源与状态

2026-11-01：Mock TTS 及原离线 WAV 目录、manifest 已移除，当前剧情包和后端部署不再依赖这些文件。此前语音由本机 eSpeak NG 1.52.0（`cmn`、175 words/minute）生成，不包含真人录音，也未作为正式角色音色验收。

音频编解码、私有媒体与浏览器播放测试使用 [测试信号生成器](../tests/fixtures/audio.ts) 在内存中生成 PCM WAV，再按需经 FFmpeg 编码。该信号为固定正弦波，不是语音、用户录音或生产 TTS 实现；无密钥 Mock 后续通过显式 text.ready 字幕模式演出，不将测试音频作为生产语音。

未提供真人录音或最终 Mira 模型。前端使用真实 Live2D Haru 官方技术替身与本项目自绘海岸照片 `apps/web/public/assets/travel-photo.svg`，匹配 Mock 照片台词。旧探索和原型保留在本地，运行/构建不从探索目录加载。

## 当前Live2D资源

`apps/web/public/assets/live2d`包含已核验的同源Pixi6.5.10、pixi-live2d-display0.4.0、CubismCore5.1.0及官方Haru样例；来源/许可/每文件SHA-256见该目录的NOTICE.md与SOURCES.json。运行manifest仅保留实际所需Moc/双纹理/physics/pose/CDI/userdata，未发布样例语音或未使用motion/expression。故障poster由同一个Haru模型实际渲染得到，受同样素材条款约束。咖啡馆背景取自本项目Live2D探索资产；不改动历史探索目录。

## Miara 角色资源

`apps/web/public/assets/live2d/miara/` 保存 Miara 运行时模型、纹理、物理、参数说明和三段原始动作，共 8 个文件。它们从固定提交的公开镜像取得，来源与 SHA-256 纳入 Live2D `SOURCES.json`；不是原创 Mira 素材，适用保留的 Live2D 样例条款。WebGAL 已通过角色 profiles 接入 Miara，Haru 继续默认，Miara 显式可选。模型参数与编辑工程边界见该目录 README，实际验收范围见 `docs/acceptance/miara-webgal-story.md`。

## WebGAL 可见引擎示例

`apps/web/public/assets/webgal-demo/cafe-night.svg` 与 `cafe-dusk.svg` 是为本项目编写的原创 SVG 插图，不含外部照片或字体。示例调用固定 WebGAL 源码中的原生雨效和纹理，条款沿用保留的 WebGAL MPL/素材说明。详细来源见该目录 README；不导入上游 `public/game` 剧情和音频。

## 最后一盏灯场景

八个独立动漫手绘风格背景与三个打烊变体位于 `apps/web/public/assets/cafe-story/`，由用户授权使用已配置图像 API、`gpt-image-2` 和 imagegen 内置 CLI 生成，替换原有简单 SVG。完整生成提示词见 [场景生成稿](cafe-story-prompts/PROMPTS.md)；来源、原生尺寸、WebP 处理和每文件 SHA-256 随场景目录保存。全部不含人物，Live2D 的素材归属独立保留。

2026-11-02：走廊旧海报署名和吧台旧信封已做本地栅格修补，分别改为无署名风景画与饮品卡；脚本为 `scripts/retouch-cafe-props.py`，原图哈希与新文件哈希保留在场景 `SOURCES.json`，没有新增图像 API 请求。

`apps/web/public/SOURCES.json` 记录平台图标、旅行照片和引擎预览图片的来源与 SHA-256；Live2D 和故事背景继续保留各自清单。`npm run assets:check` 核对全部公开运行资源的清单覆盖、哈希和本地引用；当前场景未声明离线 WAV，离线音频检查计数为零。检查不播放音频或调用外部服务。

`assets/images/window-keepsake-mock.webp` 是现有窗边背景的服务端部署副本，仅用于明确标记的模拟图片分享；来源与 SHA-256 见 `assets/images/SOURCES.json`，许可沿用上述原创场景图。Docker 与服务端发布包携带它，不依赖前端 public 目录。真实生成图片仅写私有媒体目录/对象存储，不入库。工作流副本 `apps/server/src/images/workflow/api.json` 与 `params.json` 复用用户指定的 baseGenerate 采样图，仅保存必要 API 节点与经修正的绑定，原探索 prompt/UI data 不作为运行依赖。
