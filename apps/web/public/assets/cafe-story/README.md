# 最后一盏灯：场景资产

八个独立的动漫手绘风格栅格背景及三个打烊状态变体。画面采用低饱和度、水粉笔触、柔和雨夜光线和日常旧店材质；每张有独立构图，不包含人物。Miara/Haru 由同一 WebGAL 舞台另行渲染。

基础图：street-wide、cafe-front、lobby、window-seat、photo-corridor、washroom、counter、street-walk。三个打烊变体基于对应基础图编辑灯光与营业牌，不作为新增背景计数。运行文件为 1664×936 WebP，映射至 2560×1440 舞台坐标；前景遮挡取自同一张已加载背景的纹理，保持桌面和台盆细节。

素材由用户授权的图像 API 生成，模型为 `gpt-image-2`，通过 imagegen 技能内置 CLI 调用已配置的兼容服务。手绘是视觉风格描述，实际来源为 AI 生成。完整提示词见仓库根 `assets/cafe-story-prompts/PROMPTS.md`。服务原生返回 1672×941（请求为 2560×1440）；运行图仅做轻微比例校正和缩小，没有插值放大。

`SOURCES.json` 保存来源、原生/运行尺寸、处理方式、每文件 SHA-256 和字节数。本地 PNG 成品位于 `outputs/cafe-art-refresh/final/`，不作为构建依赖。使用 Pillow 运行 `python scripts/prepare-cafe-art.py outputs/cafe-art-refresh/final` 可重新打包 WebP 和哈希；该脚本不访问 API、不读取密钥。

信封保持闭合，不包含信件正文；照片无人。精确的信件/海报阅读文本仍由场景注册表与舞台文字层提供。雨只通过引擎在室外或窗外呈现，图片保留湿地面和玻璃水珠。

资源变化后运行 `npm run assets:check`。Haru/Miara 的许可与归属继续见上级 live2d/NOTICE.md，不适用本目录原创背景说明。
