# 版本控制范围

本轮显式纳入[轻量剧情控制设计提案](../architecture/narrative-runtime-design.md)，对应`.gitignore`单文件白名单。它是待实施设计，不替代当前运行架构或验收记录。

本仓库保存可运行工程和维护它所需的文件。首次整理不删除本地资料；通过根 `.gitignore` 的目录与文档白名单（含已实现的连接监测说明）避免误提交。

| 纳入范围                                                 | 原因                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| `apps/`、`packages/protocol/`、`packages/webgal-parser/` | 前后端、WebGAL 固定源码 fork、共享 schema、parser 与测试源码          |
| `tests/`、`scripts/`                                     | fixtures、浏览器测试源码、启动/版本选择、协议生成、诊断与资产校验脚本 |
| 根 npm/TS/Vite/Vitest/Playwright/ESLint/Prettier 配置    | 固定依赖并复现开发、构建和检查                                        |
| `.github/`、`infra/`、`compose.yaml`                     | CI、Docker 与反向代理源码                                             |
| `.vscode/`                                               | 共享调试任务及被 `npm run dev` 引用的启动脚本，不是个人缓存           |
| 三份 `.env*.example`                                     | 无真实凭证的公开配置模板                                              |
| `assets/mock-audio/`                                     | 无密钥演示需要的固定语音素材及来源 manifest                           |
| `apps/web/public/assets/`                                | 页面图片、Live2D 模型/纹理、固定运行库与全部适用条款                  |
| 文档白名单                                               | 当前配置、架构、契约、开发、部署及验收摘要                            |

Live2D 的 `.moc3`、纹理和已压缩第三方 JS 是加载角色必须的受版本固定的发行资产，不能与本工程生成的 `dist/` 混为一类。其 `SOURCES.json`、上游 manifest 和条款同时保留；Haru 技术替身归属不变。OpenAPI 是从共享 schema/真实路由生成并检查一致性的公开契约，保留在版本控制中。

Miara 的 8 个运行时文件与三段原始动作保存于 `apps/web/public/assets/live2d/miara/`，其公开镜像提交、逐文件来源和 SHA-256 纳入同一 Live2D 资产清单；Haru 文件保持原样。按用户要求保留的交接文件 `docs/prompts/miara-webgal-implementation.md` 单独加入白名单，其他历史 prompt 继续排除。资源入库不表示 Miara/WebGAL 产品功能已接通。

本次场景方案审阅将 `docs/miara-webgal-scenario-design.md` 显式加入文档白名单，并与实施 prompt 关联。它记录待实施的产品设计、契约建议和验收目标，不能作为当前实现或测试通过的证明；其他历史研究稿仍按原规则排除。

WebGAL 源码及必要源码资源随 MPL、字体/音效条款、`third-party/webgal/SOURCES.json` 与 `PATCHES.json` 入库；上游原始格式保留，构建结果仍排除。迁移开发与验收文档加入白名单，历史研究稿继续本地保留。`npm run webgal:check` 校验来源和补丁是否漂移。

明确排除：真实 `.env` 及备份、密钥/证书、用户录音与私有媒体、`node_modules`、`dist`、缓存、source maps、测试报告、截图录像、`outputs/`、`tmp/`、原始需求 PDF、历史设计与未实施研究稿。它们仍在本地，公开文档不依赖这些本地文件链接。

## 提交检查

提交使用明确路径，不强制添加被忽略文件。提交前检查：

```sh
git status --short
git diff --cached --stat
git diff --cached --check
git ls-files
```

检查实际暂存 blob 中的凭证、私人路径、异常大文件与禁止目录；新增资产时运行 `npm run assets:check`。`.gitignore` 不会保护已被追踪的文件，因此后续仍需检查暂存内容。

本次仓库整理仅运行静态检查、资产哈希检查与 Git 暂存内容检查，没有新增功能/运行时/E2E测试结果。此类测试须按 `AGENTS.md` 在用户明确要求后执行；CI 依照既有工作流运行其门禁。

八场景接入新增 `apps/web/public/assets/cafe-story/` 的原创 SVG/来源清单、离线故事 WAV、`scripts/create-cafe-art.py`、角色/场景/宿主代码与测试源码；`docs/acceptance/miara-webgal-story.md` 显式加入文档白名单。`outputs/miara-implementation/` 的手动调试截图继续排除，未加入真实音频或凭证。

Ink源文件与角色/Lore/manifest随scenario包纳入；compiled.json为可复现的生成文件，Git忽略，由dev/typecheck/build准备生成并随server dist发布。不要手改bytecode，也不要提交会话存档或截图。

WebGAL 交互整理新增 `docs/architecture/webgal-interaction-design.md` 单文件白名单，记录已实施的前端按钮归属和显示规则。截图仍留在被忽略的 outputs 目录，未新增功能/E2E/运行时测试执行结果。

场景模块公开产物 `apps/web/src/webgal/scenes/*/manifest.generated.json` 由scenarios:build从严格筛选的呈现配置生成，可随源码保存并由scenarios:check校验；不得包含Lore、Ink字节码、私有标记或存档。后端compiled.json仍忽略并由准备脚本重建。场景模块边界见architecture/scene-modules.md。
