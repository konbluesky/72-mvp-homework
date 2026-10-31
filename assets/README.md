# 素材来源与状态

`mock-audio/*.wav` 是本项目原创中文短句，经 eSpeak NG 1.52.0 (`cmn`, 175 words/minute) 在本机离线合成的 PCM WAV。它们是真实语音波形，供 HTTP 下载、Web Audio 解码与播放验收；音色机械，未作为正式 Mira 音色或真人听感验收。

文本、文件名、时长、采样率与 SHA-256 见 [manifest](mock-audio/manifest.json)。项目原创文本与合成输出以 [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) 提供。eSpeak NG 生成器为 [GPL-3.0-or-later](https://github.com/espeak-ng/espeak-ng)，未随应用发布程序或模型。GPL 不自动覆盖本项目原创文本的普通程序输出。

复现：安装 `espeak-ng` 后，对 manifest 中每条文本执行 `espeak-ng -v cmn -s 175 -w <id>.wav '<text>'`。运行 demo 不需要安装此生成器。

未提供真人录音或最终 Mira 模型。前端使用真实 Live2D Haru 官方技术替身与本项目自绘海岸照片 `apps/web/public/assets/travel-photo.svg`，匹配 Mock 照片台词。旧探索和原型保留在本地，运行/构建不从探索目录加载。

## 当前Live2D资源

`apps/web/public/assets/live2d`包含已核验的同源Pixi6.5.10、pixi-live2d-display0.4.0、CubismCore5.1.0及官方Haru样例；来源/许可/每文件SHA-256见该目录的NOTICE.md与SOURCES.json。运行manifest仅保留实际所需Moc/双纹理/physics/pose/CDI/userdata，未发布样例语音或未使用motion/expression。故障poster由同一个Haru模型实际渲染得到，受同样素材条款约束。咖啡馆背景取自本项目Live2D探索资产；不改动历史探索目录。
