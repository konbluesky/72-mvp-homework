# 版本控制范围

本仓库保存可运行工程和维护它所需的文件。首次整理不删除本地资料；通过根 `.gitignore` 的目录与文档白名单避免误提交。

| 纳入范围                                              | 原因                                                                  |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| `apps/`、`packages/protocol/`                         | 前后端源码、共享 schema、组件与契约测试                               |
| `tests/`、`scripts/`                                  | fixtures、浏览器测试源码、启动/版本选择、协议生成、诊断与资产校验脚本 |
| 根 npm/TS/Vite/Vitest/Playwright/ESLint/Prettier 配置 | 固定依赖并复现开发、构建和检查                                        |
| `.github/`、`infra/`、`compose.yaml`                  | CI、Docker 与反向代理源码                                             |
| `.vscode/`                                            | 共享调试任务及被 `npm run dev` 引用的启动脚本，不是个人缓存           |
| 三份 `.env*.example`                                  | 无真实凭证的公开配置模板                                              |
| `assets/mock-audio/`                                  | 无密钥演示需要的固定语音素材及来源 manifest                           |
| `apps/web/public/assets/`                             | 页面图片、Live2D 模型/纹理、固定运行库与全部适用条款                  |
| 文档白名单                                            | 当前配置、架构、契约、开发、部署及验收摘要                            |

Live2D 的 `.moc3`、纹理和已压缩第三方 JS 是加载角色必须的受版本固定的发行资产，不能与本工程生成的 `dist/` 混为一类。其 `SOURCES.json`、上游 manifest 和条款同时保留；Haru 技术替身归属不变。OpenAPI 是从共享 schema/真实路由生成并检查一致性的公开契约，保留在版本控制中。

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
