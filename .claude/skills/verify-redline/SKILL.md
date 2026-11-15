---
name: verify-redline
description: 在隔离的 Chrome 里用模拟 AI 驱动 Redline 单文件网页，验证编辑与批注、流式请求、简历体检、导入确认、历史恢复、模板和多页导出，并留下证据。改动 Redline 的功能、状态、历史记录或导出后，或者要证明这些流程可用时使用。
---

# 验证 Redline

Redline 是单文件网页，用 `file://` 打开，没有服务器和端口。所有命令都在 `redline/` 目录运行。

## 环境与依赖

- macOS，已安装 Google Chrome。脚本通过 `playwright-core` 的 `channel: "chrome"` 启动它。
- Node ≥ 22.13（推荐 24）和 `npm ci` 装好的依赖。测试框架只有 Vitest 和 playwright-core，不要新增。
- poppler（`brew install poppler`）提供 `pdfinfo`、`pdftotext`、`pdfimages`、`pdffonts`。
- `textutil` 是 macOS 自带命令，只有 `e2e/features.mjs` 用它。

## 隔离规则

- 只用 `chromium.launch` 加 `newContext`。每条旅程都是全新的临时上下文。
- 绝不用 `launchPersistentContext`，绝不把用户的 Chrome 配置目录传给浏览器。用户选择记住的真实 Key 存在那里的 localStorage。
- 绝不读取 `.env`，绝不把真实 Key 传给脚本，绝不请求真实 AI 服务。新版可选 Key 与服务设置一起保存在 `redline.connection.v1`，旧 `redline.apiKey` 只用于迁移。
- `core-flow.mjs` 拦截所有非 `file:` 请求。发往 DeepSeek 的请求由 mock 回复，其他请求被中止并判为失败。假 Key 是 `sk-verify-fake-not-real`，通过界面的 Key 弹窗输入。

## Doctor

出现异常时先运行这条。它只读，会启动一次无头 Chrome，但不改任何文件。

```sh
node .claude/skills/verify-redline/scripts/doctor.mjs
```

结尾是 `DOCTOR OK` 才继续。`fail` 必须先处理。`warn` 表示某个产物过期或缺失，输出里写了修复命令。

## Launch

```sh
npm run build
```

构建产物是 `dist/index.html`。`npm run build` 会先跑 `tsc --noEmit`。`npm run e2e` 不会自动构建，改完源码不构建就是在测旧代码。

发布用 `npm run verify:release`（`npm run release` 是同一入口）。它只构建一次，随后运行单测、全量 E2E 与七条核心流程。九组报告都必须包含案例、全部通过，且 HTML 哈希对应本次构建；模板、临时会话、AI、画布编辑、左栏和分页导出的必测案例也不能缺少，随后才更新 `Redline.html`。本次 PDF、图片和报告都写入新建的 `e2e/out/release/<本次运行>/`，旧证据不参与测试。验证失败不会更新交付文件。

## Drive

核心流程。每条旅程用独立上下文，一条失败不影响其他旅程。

```sh
node .claude/skills/verify-redline/scripts/core-flow.mjs
node .claude/skills/verify-redline/scripts/core-flow.mjs review-history pdf
REDLINE_HTML=Redline.html node .claude/skills/verify-redline/scripts/core-flow.mjs
```

旅程 ID 是 `review`、`review-history`、`resolve`、`import`、`backup`、`closing-summary`、`pdf`。全部通过时退出码是 0，有失败时是 1，ID 写错时是 2。全部旅程约 15 秒。`REDLINE_HTML` 用来测交付文件或别的构建，默认测 `dist/index.html`。

全量回归：

```sh
npm run verify:release
```

只调试测试而不更新交付文件时，依次运行 `npm run build`、`npm test`、`npm run e2e` 和 `node .claude/skills/verify-redline/scripts/core-flow.mjs`。

| 入口 | 覆盖 | 依赖 |
| --- | --- | --- |
| `npm test` | `src/lib` 的解析、差异、存储校验、弹窗和批注状态机，以及发布验证失败时保留交付文件 | 无需浏览器和构建 |
| `e2e/regressions.mjs` | 独占编辑、Key 防重/取消、保存成本和失败恢复、照片/导入过期回调、减弱动效截图 | `dist/index.html` 或 `REDLINE_HTML` |
| `e2e/audit-regressions.mjs` | 审查发现的存储原子性、备份撤销与竞态、事实核对、过期方案、预览与打印、隐私范围、定制关闭、键盘和窄屏等回归 | `dist/index.html` 或 `REDLINE_HTML`；`AUDIT_OUT` 指定证据目录 |
| `e2e/session-fallback.mjs` | 无可用独占锁时，临时页之间及持久页的隔离；锁调用拒绝、旧存档和存储不可用 | `dist/index.html` 或 `REDLINE_HTML`；`SESSION_FALLBACK_OUT` 指定证据目录 |
| `e2e/templates.mjs` | 21 款模板、分类检索、节点与正文完整性、一页 PDF、长文本/网址/照片/空模块、样式覆盖和代表性历史恢复 | `dist/index.html` 或 `REDLINE_HTML`；`TEMPLATES_OUT` 指定证据目录 |
| `e2e/ai-upgrades.mjs` | 端点与模型、凭据边界、无 JD 体检、真实分块进度、取消、手动重试、导入和岗位匹配摘要 | `dist/index.html` 或 `REDLINE_HTML`；`AI_UPGRADES_OUT` 指定证据目录 |
| `e2e/editor-upgrades.mjs` | 无 Key 直接编辑、占位符、过期保护、标题与跨段引用、多批注图钉、单行微调和岗位历史 | `dist/index.html` 或 `REDLINE_HTML`；`EDITOR_OUT` 指定证据目录 |
| `e2e/leftpanel-upgrades.mjs` | 拖拽与按钮排序、全部展开收起、版本重命名与对比、照片裁切与竞态、版式控件和文本导出 | `dist/index.html` 或 `REDLINE_HTML`；`LEFTPANEL_UPGRADES_OUT` 指定证据目录 |
| `e2e/layout-upgrades.mjs` | 加粗与链接导出、多页 PDF、超限拦截、压缩失败恢复、深色界面与白色纸面 | `dist/index.html` 或 `REDLINE_HTML`；`LAYOUT_UPGRADES_OUT` 指定证据目录 |
| `e2e/pagination.mjs` | 页数显示与 PDF 对齐、页数上限、分栏、超长条目、压缩事务及内容完整性 | `dist/index.html` 或 `REDLINE_HTML`；`PAGINATION_OUT` 指定证据目录 |
| `e2e/run.mjs` | Key 校验、预览、过期方案、刷新后的解决状态、模板和三份 PDF | `dist/index.html` 或 `REDLINE_HTML` |
| `e2e/features.mjs` | 选项、部分接受、岗位定制、版本、文件导入、照片、字体、组件格式 | 同一构建和 `run.mjs` 的产物 |
| `e2e/review.mjs` | 导入确认、撤销重做、导出检查 | `dist/index.html` 或 `REDLINE_HTML` |
| `e2e/interactions.mjs` | 批注框草稿和定位、键盘漫游、定位到目标、Toast 撤销、取消重试、下一条待处理、缩放、退出动效、减弱动效、触屏 | `dist/index.html` 或 `REDLINE_HTML` |
| `e2e/details.mjs` | 悬停和焦点轮廓、阴影色调、唯一的实心按钮、入场和错峰、Toast 计时、页签下的边线和滑块、左栏折叠、缩放跟随窗口和左栏、提示气泡不进 PDF、批注框边缘不切字、页签记住位置、选中后字段滚进视野、联系方式整行、引导步骤折行、导入核对框贴合文字、「已解决」的空状态说明、批量接受的提示、条目字段名、新条目命名时不收起、技能行的圆点、提示气泡的边距、箭头、配色和字重、轻按钮在变色行上的悬停、模块标题和分组标题的层级、选填分组默认收起、窄窗口的面板宽度、AI 重写的显示、预览提示、填 Key 绕路后草稿保留并继续、批注卡片的 `data-state`、要点的块编辑、回车接受、卡片和图钉呼应、键盘漫游的组件名标签、拖宽面板、点击折叠的滑动、格式方案卡只列变化并在决定后收成一行、批注框打开时的光晕（范围、层级、弯曲、重新开始、扫完停绘、减弱动效、不打印） | `dist/index.html` 或 `REDLINE_HTML` |
| `core-flow.mjs` | 核心流程的完整用户路径 | `dist/index.html` 或 `REDLINE_HTML` |

## 状态机

断言状态时读这些显式状态，不要从类名和文字去猜。纯逻辑在 `src/lib`，有单测。

| 状态 | 位置 | 取值 |
| --- | --- | --- |
| 弹窗和 Key 绕路 | `src/lib/dialogs.ts` 的 `dialogs` | 关闭、`import`、`tailor`、`audit`、`block`，或 `key` 加上返回去向 |
| 方案 | `src/lib/threads.ts` 的 `MOVES` | `pending`、`accepted`、`rejected` |
| 批注 | `src/lib/threads.ts` 的 `threadState`，卡片上的 `data-state` | `asking`、`resolved`、`deciding`、`failed`、`open` |
| 每个批注的请求 | App 的 `requests`，`busy` 是它的键 | 没有请求，或进行中，`byUser` 标记用户取消 |
| 导入弹窗 | `Dialogs.tsx` 的 `ImportPhase` | `edit`、`reading`、`structuring`、`review` |
| 压缩到一页 | App 的 `fit` | `idle`、`running`、`failed` |
| 缩放 | App 的 `ZoomBy` | `layout`、`fit`，或用户选的数字 |

只有一个布尔值或一个计时器的状态没有单独抽出来，例如 Toast 计时、左栏折叠、拖动宽度、光晕的一次扫动。

## e2e 脚本的产物依赖

- `features.mjs` 读取 `run.mjs` 写出的 `e2e/out/1-start.png`、`qingjun.pdf` 和 `fenlan.pdf`。缺少这些文件时，它在设置照片那一步报 `ENOENT` 退出。
- 单独运行 `features.mjs` 时，旧文件仍可能被使用。改过模板或打印样式后，先跑 `run.mjs`。doctor 会警告默认目录里的产物早于当前构建。
- `run.mjs` 和 `features.mjs` 读取同一个 `OUT` 环境变量，默认是 `e2e/out`。单独运行两条命令时必须用相同值。`verify:release` 会设置本次独立目录，因此缺少新生成文件时直接失败，不会读取旧 PDF。
- `npm run e2e` 的顺序是 `regressions`、`audit-regressions`、`session-fallback`、`templates`、`ai-upgrades`、`editor-upgrades`、`leftpanel-upgrades`、`layout-upgrades`、`pagination`、`run`、`features`、`review`、`interactions`、`details`，用 `&&` 连接，前一个失败后面就不运行。不要调换 `run` 和 `features` 的先后顺序。
- `review.mjs`、`interactions.mjs`、`details.mjs` 和 `core-flow.mjs` 不依赖其他脚本的产物，可以单独运行。

## 变异测试

`scripts/mutate.mjs` 每次在源码副本里改坏一处细节，构建后跑 `e2e/details.mjs`，确认它在预期的那条检查处失败。标了 `unit:` 的行改跑 Vitest，确认预期的单元测试失败。标了 `flow <旅程>:` 的行改跑 `core-flow.mjs` 的那条旅程。

```sh
node .claude/skills/verify-redline/scripts/mutate.mjs
node .claude/skills/verify-redline/scripts/mutate.mjs "composer|zoom"
```

- 副本放在 `e2e/out/mut/`，结束后删除。四路并行，检查数量以脚本中的当前变异表为准，运行时间随检查数量变化。
- 运行期间不要再开别的浏览器测试。悬停轮廓那条检查按帧采样，机器太忙时会采不到帧而误报。
- 结尾是 `MUTATIONS n/n CAUGHT` 且退出码为 0 才算通过。
- `SETUP` 表示要改的原文在源码里找不到或不止一处。源码改过之后更新这一行的原文，不要删掉这一行。
- `MISSED` 表示检查没抓到这次破坏。修检查，不要改变异去迁就它。
- 分栏模板的切字检查是硬断言；任何切字都会使 `details.mjs` 失败。

## Evidence

证据写到 `e2e/out/verify/<运行时间>/`，已被 git 忽略。`VERIFY_OUT` 可以改位置。

- `report.json` 记录被测 HTML 的路径和 SHA-256、Chrome 版本、每条旅程的状态、通过的检查、失败原因、AI 请求摘要和被拦截的请求。请求摘要不含 Key。
- `verify:release` 的报告位于本次目录的 `core`、`regressions`、`audit-regressions`、`session-fallback`、`templates`、`ai-upgrades`、`editor-upgrades`、`leftpanel-upgrades`、`layout-upgrades` 和 `pagination` 子目录；成功时另写 `release.json`，记录交付文件与构建共享的 SHA-256。入口会覆盖对应的输出环境变量，确保读取本次报告。
- 升级脚本通常写 `report.json`，案例为 `cases:[{id,status}]`；`editor-upgrades` 写 `results.json`，案例为 `cases:[{name,passed}]`。发布入口按各自文件和结构核验，并逐一要求当前固定场景 ID。
- `<旅程>/*.png` 是操作后的截图，失败时有 `failure.png`。
- `backup/backup.json` 是下载到的备份，`pdf/export.pdf` 和 `pdf/export.txt` 是导出结果。

汇报时给出证据目录，并核对 `htmlSha256` 对应你要测的构建。证明标准如下：

- 走用户入口，不直接调用内部状态。IndexedDB 和 localStorage 只用来只读核对；旧版数据迁移的专用测试可预置旧 localStorage。
- 同时断言界面和存储里的结果。
- 新增或修改检查后，故意改坏对应行为，确认检查变红。`details.mjs`、`core-flow.mjs` 和单元测试的检查在 `scripts/mutate.mjs` 的表里加一行。其他脚本在 scratchpad 的源码副本里改，用 `REDLINE_HTML` 指向副本的构建结果。检查不会变红就没有证明力。
- 旅程里读页面文字用不等待的写法，比如 `allInnerTexts()`。`innerText()` 找不到元素时会等到超时，失败信息就不是检查名，`mutate.mjs` 认不出来。
- 不要为了变绿放宽断言。失败写进对应特性文件的 `Gotchas`，并让对应检查返回非零退出码。所有检查通过后才能发布。

## 未覆盖的边界

- `window.print` 被替换成计数，脚本证明按钮触发一次打印，PDF 由 `page.pdf` 在打印媒体下生成。系统打印对话框没有被驱动。
- 真实 AI 回复质量、任意兼容服务的跨域设置和实际网络状况不在范围内。分块、断流、取消、超长及坏 JSON 由本地模拟与单测验证。
- 只测 Chrome，不测 Safari 和 Firefox。
- 视觉细节靠计算样式和几何位置断言，没有截图像素比对。改了版式、配色或阴影，要自己看截图。
- `Meta+z` 快捷键由现有 e2e 覆盖，`core-flow.mjs` 用工具栏按钮。

## Cleanup

脚本结束时关闭自己的浏览器，没有后台进程要清理。证据目录要保留。旧证据只在用户要求时删除。运行被中断时，只结束你启动的那个进程，不要按进程名杀 Chrome，用户自己的 Chrome 可能正在运行。

## 特性地图

驱动某个功能前先读 [features/README.md](features/README.md)。功能变化后用 `/pstack:maintain-verification-skill` 更新地图。
