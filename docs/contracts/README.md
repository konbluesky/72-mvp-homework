# 网络契约

协议唯一来源：`packages/protocol/src/index.ts`。HTTP 路由元数据和 Zod schemas 生成 [OpenAPI](openapi.json)，`npm run contracts:generate` 更新，`npm run contracts:check` 检查一致性并由 Swagger Parser 验证。

## 会话与输入

1. `POST /api/sessions` 返回短期 sessionToken与capabilities.voiceInput。浏览器仅在内存保存token，按实际能力开放录音，不由Mock/Live字符串推断。
2. 对该会话所有操作用 `Authorization: Bearer <sessionToken>`；私有媒体另带 `X-Session-Id`。令牌不放 URL。
3. `POST /api/sessions/:id/turns` 提交 `{turnId,generation,receipts,frozenTurns}`。generation 是会话内单调正整数，同代同ID幂等，同代不同ID冲突，旧代拒绝。
4. 等 begin 确认后 `POST .../:turnId/input`。文字：`{generation,inputId,text}`。录音：multipart 中 `metadata` 是 `{generation,inputId,durationMs}` JSON，`audio` 是真实 MIME 的文件，客户端不得只修改扩展名。
5. 同轮同 inputId 和摘要不会二次调用 Provider：进行中 `INPUT_IN_PROGRESS`，已完成 `INPUT_COMPLETED`，已取消 `TURN_CANCELLED`。不同内容或不同 inputId 重用已提交轮次返回 `INPUT_CONFLICT`。这些都是 409，无自动旧音频重放。

## SSE

fetch POST 读取 ReadableStream。每个帧 `data: <JSON>\n\n`，心跳 `: heartbeat\n\n`。UTF-8、CRLF、跨chunk、多行data由同一 parser 处理；不完整尾帧、未知版本、序号缺口或身份不匹配受控中止。相同eventId/相同内容可忽略，冲突内容拒绝。

统一字段：schemaVersion=1、sessionId、generation、turnId、eventId、seq（从1连续递增）、type、payload。

| type              | 语义                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| ready             | 连接已准备好；payload.streamId为服务端生成；remainingLifetimeMs为剩余呈现预算，客户端提前1秒冻结/取消 |
| input.transcribed | 转录结果；Mock明确simulated=true                                                                      |
| audio.ready       | segmentId、text、audioUrl、emotion、action、events；音频单独鉴权下载                                  |
| reply.done        | **生成完成**，有效播放仍可继续；不代表用户已听完                                                      |
| error             | 稳定code/message/retryable；流开始后不用第二次HTTP JSON响应                                           |

SSE正常完成不会中断有效播放。异常断线取消该stream拥有的任务；重新连接只查询快照或开始新轮，不重播事件。

## 实际呈现与回执

`POST .../receipts` 接收 `{receipts}`，返回 `acknowledged` receiptId列表。Receipt含完整TurnIdentity以及receiptId、targetId、kind（segment/photo/environment）、status（presented/failed），句子可带mode=audio/text。

- 音频播放完毕提交 segment presented；被打断半句不提交完成。
- 字幕降级由用户逐句确认，标为mode=text，不声称播放声音。
- 照片解码且真正显示后提交 photo presented，对应 `photo_revealed`。
- 环境变化独立确认，对应 `rain_softened`。
- 仅接收确实发给本会话的事件/片段，客户端不能直接写事实。
- 本地取消冻结快照，下一begin先合并累计回执再构造上下文；重复/乱序不能撤回事实或扩充已冻结结果。

`POST .../:turnId/cancel` 接收 `{generation,receipts,frozen:true}`，只作用于指定轮。完整schema与limits见协议源码；不要另写与代码不同的字段表。

## 失败

非流错误统一 `{error:{code,message,retryable},requestId}`。400非法数据；401无效令牌；409身份/幂等冲突；410会话失效；413上传过大；415格式不支持；429限流；502/504外部服务失败或超时；503容量不足。详情以生成OpenAPI与schema为准。

会话创建和快照现在都包含必填 `capabilities: { voiceInput: boolean }`。该新增字段由实际Provider组合生成，不携带供应商凭证。发布时先更新后端再更新前端；旧前端会忽略新增字段，新前端需要该能力字段。
