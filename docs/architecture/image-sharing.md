# 角色主动分享图片

2026-11-01 实施时仅静态验证；2026-11-02 经用户明确授权，已实际运行生图相关自动化、两入口隔离 Mock 浏览器及原版真实 Live 图片闭环。

角色的候选、外观/场景描述、台词与画面约束由场景包提供。当前场景在窗边陪伴 milestone 确认后，先完成一轮普通交流，再允许同一次 Planner 调用决定 prepare/defer/dismiss/keep 与有限 focus/mood/framing。Manager 使用该轮所有目标的成功呈现确认记录普通交流，不用历史长度或定时器授权。原静态海岸照片、Ink actionId、关系和结局授权保持独立。

合法候选同时提供标题、来源和场景编写的分享意图；Planner 明确知道这是角色可主动发起的表达，无需用户先要求照片。合法剧情动作分支也必须传播 keep/defer/dismiss，防止续聊选择了 talk 动作就把已有图片永久暂停。人物采用 Pony quality/source/rating 与外观标签，意图转换为场景编写的标签片段，不拼接中文人设或裸字段名。当前按用户参考图描述灰紫低侧马尾、蓝眼睛、深灰白边制服及蓝白丝质小颈巾；不等于把参考图输入模型或保证完全同脸。

Graph 预留每会话唯一分享，在普通回复中最多三句加一句准备台词；发布 image.pending 后结束该轮 SSE。Scheduler 实际绘制同一张占位卡，提交 image-slot 回执。Manager 幂等确认占位后才交 ImageSharingService 排队。占位未呈现即冻结，不向 ComfyUI 提交。已确认的任务归属 session/share/attempt，新用户发言只取消当前演出，不删除任务图。

后台任务有独立的 15 分钟期限、单请求 15 秒期限、默认一个运行位与八个排队位；期限也适用于排队。默认每会话一次自动分享，确定失败后允许一次手动新 attempt。重试用 requestId/expectedVersion 同步预留；图片加载失败只取原 asset，不新出图。状态为 preparing、submit_unknown、ready、presented、failed、cancelled、expired；网络未知是客户端覆盖层。取消本地分享不会宣称远端 GPU 停止，也不调用全局 interrupt/free。

POST /prompt 接单响应丢失后进入 submit_unknown。使用同一 correlationId 查询原实例 queue/history；不重新 POST、不切节点。原生适配复用了 baseGenerate API 图和参数绑定，清除了旧 Compile Model+ 与 UI 图中不在 API 内的节点。默认选择标准 SaveImage + /view；SaveImageS3 使用显式对象 origin 与 images[].filename/subfolder（兼容该 origin 的 URL 输出），不能假设 S3 可从 /view 下载。任何输出地址只能来自已配置实例/对象 origin，禁止重定向，模型不能控制地址或标识。

服务端只接受有界 PNG/JPEG/WebP 字节，检查签名后以受限 FFmpeg 解码单帧、限制像素与输出字节并剥离 metadata，保存为私有 PNG。图片与音频分别有容量上限、有效期、所有者和 R2 前缀。deleteTurn 只删除 turn 音频；分享取消/到期、会话重开/结束与 close 回收任务图和迟到写入。不声称基本格式检查已经解决人物身份、手部、服装连续性或像素语义检测。

前端 MediaShareCoordinator 为两个入口维护同一份状态，条目仅引用 shareId。卡片固定预览尺寸、原位替换、保留来源与模拟标识。回看最多六十条，保留媒体锚点；近期六组裁剪后提供状态入口。状态查询为单 in-flight，请求完成后约两秒再查，离线/隐藏暂停、失败退避。查询只能合并单调版本与终态，不直接播放、显图或提交回执。未确认取消保持 cancelRequested，使用幂等取消接口继续对账，不能把网络失败误报为已取消。

ready 不要求新用户消息。Controller 在严格空闲门禁下申请独立 media-share begin，携带 expectedGeneration、share version 与冻结回执。Manager 先合并最终回执，再原子检查当前所有目标已确认、场景/资产期限及唯一 claim。媒体 input 使用真实媒体分支，不写虚假用户消息、不调用 GPT、不绕过 Ink 动作权限。新输入/录音/IME、草稿、上翻历史、隐藏、模态层或资源加载阻止自动展示；空输入框仍聚焦不阻止静默完成。切换角色 profile 取消尚未完成的旧分享，同 profile 舞台重建只恢复舞台。

Scheduler 共同预加载图片与引出台词，随后原位绘制实际预览图、校验其解码和可见尺寸，再提交 image 回执并播放引出台词。关闭 lightbox 里的隐藏 img 不能充当呈现证据。收起加载中的卡片/新输入会撤销展示准备。图像、字幕/音频与占位回执各自独立；声音结束、下载结束、ready 或 reply.done 均不代表用户看过图。失败保留原卡，音频故障保留已有声音重试/明确字幕恢复。

分享记忆仅由 Manager 在合法 image 回执后幂等写入，不设置 photo_seen，不推进 Ink 或关系。暂断 SSE 的 provisional cancel 保留 issued claim，最终冻结回执先对账再释放，避免已显示图片丢失记忆。上下文只提供创作意图、来源和分享状态，没有视觉识别时不承诺知道实际像素细节。

两个入口保留仓库既有 BrowserPersistence 会话恢复；本功能不新增凭证持久化。图片状态/私有 URL 不写浏览器存储，阅读记录只保存 shareId 引用。同页重连先交冻结回执并对账 snapshot，再恢复卡片和轮询，不重播旧声音。已确认历史缩略图使用独立静态恢复路径，不重新提交分享回执。服务重启或旧会话失效时不能恢复内存任务，沿用会话结束入口。

Mock 默认不联网生成图片，使用随服务端资产发布的场景背景，并在卡片明确标“模拟”；没有 Deepgram 配置时普通回复和分享引出台词通过显式 text.ready 字幕模式呈现，不创建假音频或恢复旧 WAV。已有 Deepgram 配置时可继续使用其真实语音；Live 从不静默回退 Mock。可通过 MOCK_IMAGE_DELAY_MS 与 MOCK_IMAGE_FAILURE=first/always 准备慢等待、失败和一次手动重试演示。

实施阶段新增了占位重放、冻结、候选门禁、claim 暂断/最终确认、重试/取消竞态、旧自动申请不抢用户轮次、ComfyUI 接单未知对账/S3 地址约束、共享版本合并/媒体锚点保留和 Scheduler 预加载/打断测试源码。

2026-11-02 已实际执行生图相关回归、runtime 脚本和七个隔离 Mock 浏览器场景，两个入口均验证占位、失败重试、取消、恢复、实际解码与图片回执；390×844 和 390×500 是浏览器可用视口，不冒称手机软键盘真机。原版另使用真实 GPT、Deepgram 与用户 ComfyUI 节点走通主动准备、续聊、原卡查看和 presented 记忆，单任务只 POST 一次。该次 Live 续聊后采用明确点击查看；自动展开由 Mock 浏览器场景覆盖。参考图 Pony 标签另做真实校准出图。

实际验证修复了按钮持焦永久阻断、空闲周期恢复、预览裁剪、manual 查看与新输入竞争、历史 Blob URL 回收、合法剧情动作丢失 keep/dismiss 以及未呈现占位空占额度等问题。仍未覆盖真机系统后台/键盘、参考图身份锁定；全仓扩展还有十二项非生图用例失败和七个未处理拒绝，不能把本功能通过表述为整个项目全绿。
