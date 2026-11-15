# 导入确认

用户粘贴或选择简历文件，AI 整理成结构化内容。用户核对原文和结果后才替换当前简历，替换后可以撤销。原文末尾的个人总结、自我评价这类成段文字，导入后仍在末尾，标题也保留。

## Sub-features

- `import-review` 确认弹窗并排显示只读原文和可编辑结果。结果里的输入框高度贴合文字。
- `import-flag` 结果里有原文没有的内容时给出提示。
- `import-back` 返回不改变当前简历。
- `import-confirm` 确认后使用核对过的内容并清空批注。
- `import-undo` 撤销一起恢复简历和批注，重做再次导入。
- `import-closing` 成段文字整理成段落模块（`kind: "text"`），按原文顺序排列。模型仍把末尾的个人总结放进个人简介时，程序按它在原文里的位置放回末尾，标题取原文里它上面那一行。
- `import-key-detour` 没有 Key 时点“开始整理”先打开 Key 弹窗。关掉 Key 弹窗回到导入，粘贴的原文还在，什么也不发。保存 Key 后回到导入并直接开始整理。按岗位定制的岗位描述同样处理。
- `import-limits` 文件最多 10 MB、PDF 最多 20 页、文本最多 50000 字。超限在解析或请求前拒绝；加密 PDF、无文字层的扫描版、损坏文件分别给出处理办法。
- `tailor-cancel` 岗位定制关闭时立即取消，退出动画中返回的旧响应也不能新增批注或版本。重复点击开始只发送一次请求。
- `import-stream` 显示接收到的字符数，完整回复校验后才进入核对。取消丢弃未完成结果；失败不会自动重发付费请求。
- `import-disclosure` 导入会发送原文全文；岗位定制只发送岗位描述和简历正文。弹窗说明发送范围，照片和基本联系字段不自动附带到定制请求中。
- `text-module` 左栏底部的“+ 个人总结”新建段落模块。它和其他模块一样能改标题、上下移动、删除，打印进 PDF。

## How to get to it (user POV)

- 顶栏“导入”，粘贴文本后点“开始整理”。
- 顶栏“导入”，选择 PDF、Word、TXT 或 Markdown 文件。
- 简历已经导入、个人总结跑到了顶部时，在左栏底部点“+ 个人总结”，把个人简介里的文字剪切过去。

## Driving it with core-flow

Preconditions:

- 基线前提满足。`import` 旅程先接受一处修改，让当前简历和批注与示例不同。

- **粘贴文本入口。** 运行 `node .claude/skills/verify-redline/scripts/core-flow.mjs import`。输出 `PASSED import`，证据里有 `import-confirm`、`imported` 截图。
- **文件入口。** 运行 `node e2e/run.mjs`，再运行 `node e2e/features.mjs`。输出 `FEATURES PASSED`。
- **末尾的个人总结。** 运行 `node .claude/skills/verify-redline/scripts/core-flow.mjs closing-summary`。旅程先在左栏手动把个人简介移成末尾的个人总结并导出 PDF，再生成一份末尾带个人总结的 PDF 导入两次。第一次 mock 按提示词回段落模块，第二次 mock 把它塞进个人简介。证据里有 `moved.pdf`、`closing.pdf` 和两张核对截图。
- **核对框高度和 Key 绕路。** `node e2e/details.mjs` 里有这几条检查，结尾是 `DETAILS PASSED`。
- **流式导入与取消。** `node e2e/ai-upgrades.mjs streaming_import cancel_stream` 验证分块进度、完整结果门槛和 Reader 取消，详见 [AI 连接与体检](./ai.md)。

## Gotchas

- 文件入口依赖 `run.mjs` 生成的 PDF。单独运行时两条脚本要共享同一个 `OUT`；发布验证入口使用本次新目录，阻止读取旧 PDF。
- 点“返回”后再次“开始整理”会发出新请求，所以 mock 要准备两份回复。
- 文件读取的旅程用到 `textutil`，只能在 macOS 运行。
- 没有 Key 时点“开始整理”会换成 Key 弹窗。草稿存在 App 的 `drafts` 里，绕路的去向存在 `src/lib/dialogs.ts` 的 `back` 里，弹窗卸载后都还在。保存时移除 Key 只回到导入，不再运行，所以不会又弹出 Key 弹窗。批注请求因 Key 失效弹出 Key 弹窗时，如果导入或定制正开着，关掉后也回到那里。2026-11-03 之前原文随导入弹窗一起关掉。`details.mjs` 守着这条路径，core-flow 的 `import` 旅程仍先在顶栏填 Key。
- 核对框左边的原文是发出去的那份。整理期间改了输入框，核对框仍显示当时发送的原文，未核实内容也按它比对。2026-11-09 之前显示的是改过的文字。
- 测 Key 弹窗用 `.dialog input[type=password]`。导入弹窗里也有一个文件 `input`，`.dialog input` 会先匹配到它。
- 文件边界与 ImageBitmap 释放由 `src/lib/files.test.ts` 验证；扫描版不提供 OCR。Word 的底层读取不可中断，但关闭后结果不会再应用。
- 真实 DeepSeek 是否照提示词返回段落模块没有验证过，mock 只证明两种回答都能落到末尾。
- 放回末尾的条件是个人简介的开头在原文里排在所有模块标题之后。模型改了模块标题、原文里一个标题也找不到时，不会挪动。左右分栏的 PDF 先读左栏，左栏底部的个人总结会排在右栏模块之前，也不会挪动。
- 段落模块在页面上是 `.sec` 里的 `.passage`，没有 `.item`。它的正文在批注里算 `summary` 类型，快捷词和个人简介相同。
- 导入弹窗从窄变宽时不能有宽度过渡。输入框在挂载时按当时的宽度定高，过渡中途量会多出空行。Tailwind 的 `duration-*` 会带出 `transition-property: all`，弹窗上加了 `transition-none`。
