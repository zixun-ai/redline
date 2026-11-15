# AI 连接、流式请求与体检

用户选择兼容 Chat Completions 的地址和模型，再填写对应 Key。导入、岗位定制和无 JD 体检显示接收进度；完整回复通过校验后才生成建议。所有建议仍需用户核对。

## Sub-features

- `ai-connection` 默认 `https://api.deepseek.com` 和 `deepseek-flash`。自定义地址支持 `/v1` 或完整 `/chat/completions`，只允许 HTTPS 和本机 HTTP，不允许凭据、查询参数或片段。
- `ai-key-boundary` 修改 Base URL 立即清空正在输入的 Key、取消旧验证；旧回包不能保存到新地址。Key 默认不持久保存；选择记住时，与设置一起写入 `redline.connection.v1`。
- `ai-progress` 接收 SSE 时显示已收到的字符数，不伪造百分比。收到完整结束标记或正常结束后才解析 JSON。普通 JSON 回复也可处理。
- `ai-cancel` 取消或关闭弹窗会中断请求并停止 Reader，未完成结果不能写回。旧请求的结束回调不能覆盖新请求状态。
- `ai-retry` 空回复、坏 JSON、服务错误和截断都不会自动重发；用户可手动重试。
- `ai-audit` “AI 体检”无需岗位描述，只发送待审正文；不自动附带姓名、联系方式、照片、经历时间字段或历史批注。缺信息时提出待补充项，不凭空断言时间线问题。正文自行写入的信息仍会发送。
- `ai-matching` 岗位摘要分开显示 AI 判断的已有依据和待补充项，并可切换最近 5 份摘要；原岗位全文不持久保存。

## How to get to it (user POV)

- 右栏“填写 API Key”或“已连接”打开设置，填写 Base URL、模型和 Key，再点“验证并保存”。
- 顶栏“AI 体检” → “开始体检”；没有 Key 时绕路填写，关闭 Key 弹窗会返回体检且不发送请求。
- 顶栏“按岗位定制”粘贴岗位描述，或“导入”粘贴简历原文。请求过程中可取消。

## Driving it with core-flow

运行 `node e2e/ai-upgrades.mjs`，六项必须全部通过：

- `connection_boundary`：地址变更清 Key、取消旧验证、安全地址限制、连接记录保存与刷新。
- `streaming_audit`：无 JD、Key 绕路、3 字节真实 UTF-8 分块、可见字符进度、个人字段不发送；完整结果生成待确认批注。
- `cancel_stream`：完整 JSON 但无结束标记时不能应用；取消关闭 Reader，再次运行可完成。
- `manual_retry`：坏 JSON 仅发送一次，点击“重试”才产生第二次请求。
- `streaming_import`：部分回复不展示确认结果；完成后进入核对页，确认前不替换正文。
- `matched_summary`：普通 JSON 兼容回复保存已有依据与缺项，刷新后保留。

`AI_UPGRADES_OUT` 指定证据目录；默认 `e2e/out/ai-upgrades`。报告包含构建 SHA-256、六项状态和截图。底层协议边界由 `src/lib/deepseek-stream.test.ts` 验证，包括 CRLF、多行 data、分块 UTF-8、断流、结束原因、取消、200000 字符与 4 MiB 限额、HTTP 200 业务错误。

## Gotchas

- 所有请求必须由浏览器内 mock 接管，其他网络请求被拦截。不能用真实 Key 检查新服务。
- 原生普通 JSON 响应同样按流读取并限制总字节数；只检查最终 `content` 长度不足以限制未使用字段。
- Key 校验只用一个 token，`finish_reason: length` 合法，但必须返回有效对话结构；HTTP 200 或任意 JSON 不代表验证成功。
- 匹配依据是 AI 判断，不能写成已证实事实。手动微调建议后仍要重新核对事实。
- 服务端跨域配置、真实模型质量、计费与任意兼容服务都未通过这些模拟测试验证。
