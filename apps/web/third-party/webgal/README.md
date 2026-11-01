# WebGAL fork

来源：[OpenWebGAL/WebGAL](https://github.com/OpenWebGAL/WebGAL)，固定提交 `15173bc21339a65da34b78463fca8a304e4d503a`（引擎 4.6.6；同提交 parser 的自身版本为 4.6.5）。

- `../../src/engine/webgal/` 保存完整 Core、Stage、UI、store、hooks、类型和源码资源。
- `packages/webgal-parser/src/` 保存同提交的完整 parser 源码，作为根 npm workspace 构建。
- `SOURCES.json` 记录每个上游导入文件的原始路径和 SHA-256。
- `PATCHES.json` 记录本地修改/扩展的哈希和原因；升级时逐项与固定提交比较，不能用重新生成清单代替审查。
- `LICENSE` 是完整 MPL-2.0；修改源文件仍遵循该许可证。上游各资产的许可独立适用。

本次从固定提交的完整 GitHub 归档导入，不依赖 `tmp`、Git 子模块、Yarn 或研究快照。上游 `public/game` 演示剧本/声音、PWA、Terre、Cubism2 SDK 不作为 interactive 入口的资源依赖；项目现有同源 Haru/Core 资产和条款保持原样。

源码资源保留上游雨/雪/樱花纹理、GUI 音效及其 `license.txt`，并保留资源圆体的 OFL。思源宋体的版权信息见 `FONT-NOTICES.md`，适用同一 SIL OFL 1.1。可选 OPPOSans 二进制不纳入本项目，原生 GUI 中对应的 font-face 已移除；宿主使用系统字体。

工具链差异：统一 React/ReactDOM 18.3.1（同时满足现有 LangGraph SDK 的可选 peer）、Pixi 6.5.10、wrapper 0.5.19、Vite 8；parser 用根 TypeScript 输出浏览器 ESM 和声明，保留原生 `webgal-parser/build/types/styleParser` 类型入口。源码没有批量格式化或放宽类型检查。

本地入口是 `/webgal.html`。B0 的本地示例通过原生背景状态同步、rain 粒子和 transform 展示能力，不调用原生 `initializeScript`，不开放对话、剧本、原生 GUI 或音频执行。`host/runtimeMode.ts` 在 Core 导入前锁定模式；story 入口保留源码，当前产品不提供模式切换。AssetManager 新增 renderer detach 接缝，防止晚到加载访问已销毁 renderer，修改原因与哈希记入 PATCHES。完整业务 cue/scope/SDK/恢复治理仍属于 B2/B3。

静态检查：`npm run webgal:check`。该命令仅校验源码、锁文件和依赖方向，不启动引擎、不运行功能测试。
