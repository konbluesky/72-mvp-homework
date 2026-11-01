# 最后一盏灯：场景资产

八个独立的原创 SVG 背景及三个打烊状态变体，延续本项目既有 SVG 风格。每张有独立构图与本地文件；不是同图裁切，也不包含人物绘制。Miara/Haru 由同一 WebGAL 舞台另行渲染。

基础图：street-wide、cafe-front、lobby、window-seat、photo-corridor、washroom、counter、street-walk。营业灯状态变体不作为新增背景计数。SVG 为 1280×720 本征尺寸、2560×1440 设计坐标，限制纹理内存并保留可编辑向量源。

`SOURCES.json` 保存作者说明、生成源码与 SHA-256；源码是仓库根 `scripts/create-cafe-art.py`。本轮由 Codex 辅助编写向量源，没有使用远程图像、素材 CDN、私有图片或生成图片 API。信件/海报的阅读文本由场景注册表与舞台文字层提供。

资源变化后运行 `npm run assets:check`。Haru/Miara 的许可与归属继续见上级 live2d/NOTICE.md，不适用本目录原创背景说明。
