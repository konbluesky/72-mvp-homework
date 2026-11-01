# Miara 模型资源

本目录保存 Miara 的 8 个运行时资源，供后续 WebGAL 角色接入使用。当前默认 WebGAL 产品已接入 Miara，Haru 可显式切换并保留原实现；具体范围与验证见 `docs/acceptance/miara-webgal-story.md`。

- 模型入口：`/assets/live2d/miara/miara_pro_t03.model3.json`。
- 资源：`.moc3`、4096×4096 单张纹理、物理与参数说明、模型清单、3 个 `.motion3.json`。
- 原始动作组：`Idle → Scene1`（2.633 秒）、`Tap → Scene2`（5.167 秒）、`Flic → Scene3`（5 秒）。保留原始组名 `Flic`，不要误写成 `Flick`。
- 参数说明列出 138 个参数。头部、眉眼、身体、左右手臂及腿部可作为自定义动作候选；实际能力必须读取 `.moc3` 的真实参数索引、范围及默认值，再验证画面。
- `ParamArmL1/L2/L3`、`ParamArmR1/R2/R3` 与 `ParamLegL*`、`ParamLegR*` 是可检查的上肢/下肢通道。部分带 `F` 的参数属于精灵，不应仅凭名称当成人物或整个舞台的变换。

## 来源和条款

Miara © Live2D Inc.，是[官方样例](https://www.live2d.com/en/learn/sample/miara/)，不是本项目原创 Mira 角色。

本次从注明官方样例归属的公开镜像取得资源，固定到 [desktop-companion 的提交 25ee0a10a2b5633a7e2c8714b108e6f68cd946da](https://github.com/xShiroeNguyenx/desktop-companion/tree/25ee0a10a2b5633a7e2c8714b108e6f68cd946da/app/media/live2d/Miara)。8 个文件保持镜像原始字节；来源 URL、大小和 SHA-256 均记录于上级 `SOURCES.json`。官方 ZIP 当时不可下载，尚未独立核对官方原包的校验值；不把镜像校验宣称为原包校验。

适用上级 `vendor/licenses/Live2D-Free-Material.html` 与 `Live2D-Sample-Terms.html`，不继承镜像仓库的应用源码许可证。继续保留上级 `NOTICE.md` 的 Live2D 素材归属声明。

## 接入边界

这里只包含运行时模型；**没有 `.cmo3` / `.can3` 编辑工程**。已有绑定范围内可编写新参数曲线或新动作文件；超出已有形变时，另行取得编辑工程并补画稿/绑定。

原始 `Groups` 中口型和眨眼参数数组为空，`HitAreas` 也为空。不能据此宣称模型不具备嘴部或眼部参数；也不能假设 SDK 自动口型、自动眨眼或点击命中已接通。后续适配器须核实真实参数，并由现有 Scheduler 的实际音频能量驱动口型。

当前不自带独立 `.exp3.json`、pose、userdata 或专用坐下/起立/端咖啡动作。未提供的文件不能编造引用；能否由已有绑定完成这些姿势，需要逐项验证。

复用项目固定运行时；不要复制独立探索播放器、第二套 Pixi/Live2D 依赖或样例声音进入正式入口。Haru 及其模型、归属、poster 与加载实现保留作为备用，切换需显式进行，失败不得静默换角色。

实施交接见 `docs/prompts/miara-webgal-implementation.md`。资源改动后从仓库根目录运行 `npm run assets:check`。
