# 组件批注与 AI 建议

用户点击简历组件写下批注，所选 AI 服务给出修改方案，用户逐行决定接受或拒绝。接受后可以撤销和重做，内容和方案状态一起变化。一条批注的方案都决定完，它就算已解决，用户去下一条后移到「已解决」页签。

## Sub-features

- `review-key` 没有 Key 时批注打开 Key 弹窗，草稿保留。
- `review-key-storage` Key 默认只在当前页面内存中使用，刷新后清除。明确勾选“记住 API Key”后才与服务设置一起写入 localStorage 的 `redline.connection.v1`；旧 Key 只迁移到官方地址，取消记住或移除会清空保存的 Key。端点和模型设置仍保留，详见 [AI 连接](./ai.md)。
- `review-privacy` 批注请求只附带选中组件、必要背景和当前对话。选中基本信息组件时，该组件中的姓名、联系方式等内容会发送；其他组件的请求不自动附带这些字段。照片不发送，正文中自行写入的信息仍会随正文发送。
- `review-suggest` 方案只列出变化的行，接受前简历不变。
- `review-partial` 只应用勾选的行。
- `review-reject` 全部拒绝后简历不变，卡片显示已拒绝。
- `review-resolve` 接受或拒绝最后一个待确认方案后，批注变为已解决，两个页签的数字同时变化。卡片留在原处，编号换成对勾，直到用户点“下一条待处理”、激活别的批注或新写批注。DeepSeek 还在回复时不算已解决。回复、重试和撤销决定会重新打开它。卡片右上角的 ✓ 立即收起卡片。批量接受不留卡片，Toast 说明批注去了「已解决」。
- `review-rewrite` 小改动在卡片里逐字标红绿。大半句被换掉时（相同的字不到较长一侧的一半，且至少 12 个字），卡片先整句显示新写法，下面灰色引出“原文”。判断在 `src/lib/diff.ts` 的 `isRewrite`。
- `review-preview-note` 悬停卡片预览方案时，画布顶部出现绿色提示“预览修改 · 接受后才会生效”，样式方案是“预览整页样式”。它贴在可视区顶部，滚动时跟着，移开卡片就消失，不进 PDF。
- `review-format-card` 组件格式和整页版式的方案卡只列真正变化的项，写成“右对齐 → 左对齐”，上一轮已经接受的加粗、颜色不再重复。卡片上方不再复述“建议调整……接受后生效”，只留下“暂时做不到：……”。接受或拒绝后卡片收成一行“已接受 · 居中”，撤销按钮在行尾。文字修改的方案决定后仍显示差异，只去掉理由。时间线上用户的话是空心小圆点，AI 是红色闪光。`details.mjs` 有检查守着。
- `review-state` 每张批注卡片带 `data-state`，取值是 `asking`、`resolved`、`deciding`、`failed`、`open`，由 `src/lib/threads.ts` 的 `threadState` 算出。DeepSeek 正在回复时总是 `asking`，即使刚点了 ✓。测试和 agent 读这个属性，不要从类名和文字去猜。`details.mjs` 有检查守着。
- `review-reload` 修改、批注和解决状态在刷新后保留。
- `review-undo` 撤销恢复内容，方案回到待确认。
- `review-redo` 重做恢复内容，方案回到已接受。

## How to get to it (user POV)

- 点击简历上的条目、一句话或几个字，在批注框写要求后按 Enter。
- 接受或拒绝方案，看右栏「批注」和「已解决」的数字。悬停卡片时右上角出现 ✓。
- 工具栏的撤销和重做按钮。
- 快捷键 `⌘Z` 和 `⇧⌘Z`，焦点在输入框时不生效。

## Driving it with core-flow

Preconditions:

- 基线前提满足。

- **批注、部分接受、拒绝、刷新。** 运行 `node .claude/skills/verify-redline/scripts/core-flow.mjs review`。输出 `PASSED review`，证据里有 `suggestion`、`partial-accepted`、`rejected` 截图。
- **撤销重做。** 运行 `node .claude/skills/verify-redline/scripts/core-flow.mjs review-history`。输出 `PASSED review-history`，证据里有 `undone`、`redone` 截图。
- **解决批注。** 运行 `node .claude/skills/verify-redline/scripts/core-flow.mjs resolve`。输出 `PASSED resolve`，证据里有 `held`（决定后卡片留在原处）、`reopened`（撤销决定后重新打开）、`resolved`（刷新后都在「已解决」）截图。
- **其他入口。** 选中文字批注、单句接受、卡片上的撤销、过期方案和 `⌘Z` 由 `node e2e/run.mjs` 和 `node e2e/features.mjs` 覆盖。批量接受的 Toast、「已解决」页签的空状态说明、重写的显示和预览提示由 `node e2e/details.mjs` 覆盖。
- **直接编辑与精确引用。** `node e2e/editor-upgrades.mjs` 覆盖无 Key 修改、标题和跨段引用、多批注图钉及单行微调；详见 [直接编辑](./editing.md)。

## Gotchas

- 回归检查项。`review-history` 必须通过，它保护用鼠标接受方案后的工具栏撤销和重做。2026-11-02 修复前，这条路径在 `undo restores the page` 失败，因为 `commit` 在 `setPast` 的更新函数里才读取快照，读到的已是修改后的状态。
- 不要把悬停预览从旅程里去掉。真实用户点击“接受”前一定悬停在卡片上，这个缺陷只在有预览时出现。
- 撤销历史只在内存里，刷新后撤销按钮不可用。
- mock 判断 `max_tokens === 1` 为 Key 校验请求，其余请求按顺序消耗回复。回复没用完或不够用都判失败。
- Key 弹窗新增原生复选框，不能再用 `.dialog input` 代指 Key；用 `input[type=password]` 或可访问名称“API Key”。只有测试持久化或刷新后仍需发请求时才勾选“记住 API Key”。
- 要让 DeepSeek 停在回复中途，把 `j.hold.until` 设成一个 promise。mock 收到非 Key 校验请求后等它完成才回复。测完设回 `null`。
- 方案只能沿 `src/lib/threads.ts` 的 `MOVES` 移动：待确认可以接受或拒绝，已接受可以撤销回待确认。已拒绝的方案不能撤销，App 的 `accept`、`reject`、`revert` 遇到别的状态直接忽略。
- 每个批注同时只有一个 DeepSeek 请求，记在 App 的 `requests` 里，`busy` 只是它的键。用户点取消时 `byUser` 为真，留下“已取消，可重试。”。撤销、导入和恢复也会中止请求，但不留消息。
- 留在原处的卡片只记在内存里。刷新后已解决的批注全在「已解决」，「批注」页签是空的。
- 刷新后，不到 1 秒的消息会重放淡入。截图前等右栏 `getAnimations({ subtree: true })` 全部 `finished`，不然截到空白卡片。
- 卡片右上角的解决按钮是圆圈里的对勾，和已解决卡片的编号对勾一个形状。它平时透明，只在卡片激活或悬停时显示。用可访问名称“标记为已解决”找它。
- 预览提示是 `.stage` 里第一个子元素，`position: sticky` 加 `height: 0`，所以不会把纸面往下推。放在纸面后面时 sticky 只能往下推，滚动后就看不到了。它曾经贴在目标组件上方，结果盖住了上一行的公司名。
- 整页样式预览的提示文字没有自动检查，只看过代码。
- 已解决的卡片没有图钉，编号位置是 `.num.done` 里的对勾。数待处理的卡片不要数 `.num`。
- 2026-11-03 之前，接受和拒绝都不改 `resolved`，只有那个透明的 ✓ 能解决批注，所以「已解决」页签几乎总是空的。
