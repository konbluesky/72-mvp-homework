# 素材来源与状态

`mock-audio/*.wav` 是本项目原创中文短句，经 eSpeak NG 1.52.0 (`cmn`, 175 words/minute) 在本机离线合成的 PCM WAV。它们是真实语音波形，供 HTTP 下载、Web Audio 解码与播放验收；音色机械，未作为正式 Mira 音色或真人听感验收。

文本、文件名、时长、采样率与 SHA-256 见 [manifest](mock-audio/manifest.json)。项目原创文本与合成输出以 [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) 提供。eSpeak NG 生成器为 [GPL-3.0-or-later](https://github.com/espeak-ng/espeak-ng)，未随应用发布程序或模型。GPL 不自动覆盖本项目原创文本的普通程序输出。

复现：安装 `espeak-ng` 后，对 manifest 中每条文本执行 `espeak-ng -v cmn -s 175 -w <id>.wav '<text>'`。运行 demo 不需要安装此生成器。

未提供真人录音或最终 Mira 模型。前端使用真实 Live2D Haru 官方技术替身与本项目自绘海岸照片 `apps/web/public/assets/travel-photo.svg`，匹配 Mock 照片台词。旧探索和原型保留在本地，运行/构建不从探索目录加载。

## 当前Live2D资源

`apps/web/public/assets/live2d`包含已核验的同源Pixi6.5.10、pixi-live2d-display0.4.0、CubismCore5.1.0及官方Haru样例；来源/许可/每文件SHA-256见该目录的NOTICE.md与SOURCES.json。运行manifest仅保留实际所需Moc/双纹理/physics/pose/CDI/userdata，未发布样例语音或未使用motion/expression。故障poster由同一个Haru模型实际渲染得到，受同样素材条款约束。咖啡馆背景取自本项目Live2D探索资产；不改动历史探索目录。

## Miara 角色资源

`apps/web/public/assets/live2d/miara/` 保存 Miara 运行时模型、纹理、物理、参数说明和三段原始动作，共 8 个文件。它们从固定提交的公开镜像取得，来源与 SHA-256 纳入 Live2D `SOURCES.json`；不是原创 Mira 素材，适用保留的 Live2D 样例条款。WebGAL 已通过角色 profiles 接入 Miara，Haru 继续默认，Miara 显式可选。模型参数与编辑工程边界见该目录 README，实际验收范围见 `docs/acceptance/miara-webgal-story.md`。

## WebGAL 可见引擎示例

`apps/web/public/assets/webgal-demo/cafe-night.svg` 与 `cafe-dusk.svg` 是为本项目编写的原创 SVG 插图，不含外部照片或字体。示例调用固定 WebGAL 源码中的原生雨效和纹理，条款沿用保留的 WebGAL MPL/素材说明。详细来源见该目录 README；不导入上游 `public/game` 剧情和音频。

## 最后一盏灯场景与离线语音

八个独立动漫手绘风格背景与三个打烊变体位于 `apps/web/public/assets/cafe-story/`，由用户授权使用已配置图像 API、`gpt-image-2` 和 imagegen 内置 CLI 生成，替换原有简单 SVG。完整生成提示词见 [场景生成稿](cafe-story-prompts/PROMPTS.md)；来源、原生尺寸、WebP 处理和每文件 SHA-256 随场景目录保存。全部不含人物，Live2D 的素材归属独立保留。新增九条故事/上下文台词由 eSpeak NG/cmn 离线生成，Mock 音频现有十八条，`assets/mock-audio/manifest.json` 保存文本、时长、来源及哈希。没有使用外部 TTS 或用户录音。

`apps/web/public/SOURCES.json` 记录平台图标、旅行照片和引擎预览图片的来源与 SHA-256；Live2D 和故事背景继续保留各自清单。`npm run assets:check` 现在同时核对全部公开运行资源的清单覆盖、哈希、本地引用，以及十八条离线 WAV 的哈希、文件头、时长/采样率和场景台词绑定。检查不播放音频或调用外部服务。
