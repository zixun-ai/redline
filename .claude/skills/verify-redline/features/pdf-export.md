# PDF 与文本导出

用户点“导出 PDF”，浏览器打印简历。还有 `[待填写]` 占位符、横向溢出或超出所选页数限制时，应用先拦下并列出问题。可选 1 页、2 页或不限页数；PDF 保留文字和链接，没有应用界面。版本面板还可导出 Markdown 和纯文本。

## Sub-features

- `pdf-block` 占位符阻止打印并打开问题弹窗。
- `pdf-print` 没有问题时触发一次打印，文件名取自简历姓名，打印后恢复页面标题。
- `pdf-content` 默认示例 PDF 为一页，文字可提取，包含接受的修改，不含被替换的内容和应用界面文字。
- `pdf-pages` 版式面板设置页数上限；多页打印必须保留所有要点和最后一条内容，不多出空白页。
- `pdf-fit` 压缩只调整版式；失败恢复原版式，不删除或改写正文。
- `pdf-rich` `**加粗**` 渲染为粗体，PDF 不显示星号；网址保留可点击链接。
- `text-export` Markdown 保留加粗标记，纯文本去掉标记；两者都不包含内部节点 ID、批注或 Key。

## How to get to it (user POV)

- 顶栏“导出 PDF”，在系统打印对话框里选择存为 PDF。
- 左栏“版式”选择页数上限；左栏“版本”选择“导出 Markdown”或“导出纯文本”。

## Driving it with core-flow

Preconditions:

- 基线前提满足，`pdfinfo` 和 `pdftotext` 可用。

- **拦截、打印、内容。** 运行 `node .claude/skills/verify-redline/scripts/core-flow.mjs pdf`。输出 `PASSED pdf`，证据里有 `pdf/export.pdf`、`pdf/export.txt` 和 `export-blocked` 截图。
- **21 款模板。** 运行 `node e2e/templates.mjs`，检查所有模板、复杂内容和代表性样式覆盖案例通过；详见 [模板目录与排版](./templates.md)。`run.mjs` 与 `features.mjs` 仍覆盖原三款模板和字体选择。
- **分页、链接和压缩。** 运行 `node e2e/layout-upgrades.mjs`。`rich_text_exports`、`multipage_export`、`compression_restores`、`dark_chrome_light_paper` 均须通过。多页使用单栏、侧栏、双列和左标题四类结构，核对完整正文和末尾标记。
- **页数准确性。** 运行 `node e2e/pagination.mjs`。`single_page`、`page_limits`、`column_layouts`、`oversized_entry`、`fit_transaction` 均须通过；核对 21 款模板的单页、5 类分栏/网格、超高条目、页数限制及压缩事务。界面页数须与实际 PDF 一致，且无丢字或空白页。输出目录由 `PAGINATION_OUT` 指定。

## Gotchas

- 无头模式下 `window.print` 不产生文件。脚本把它换成计数，证明按钮确实触发打印。文件由 `page.pdf` 在打印媒体下生成，所以系统打印对话框没有被验证。
- 导出前要切回屏幕媒体，否则后续截图是打印样式。
- 去掉占位符时填回原文，不要用撤销。这条旅程的目的是测导出，不依赖撤销历史。
- 普通 PDF 文本提取可能重新排列双栏内容或自动去掉行末连字符。模板脚本同时保存普通及 `-raw` 提取结果，以原始文本流核对全文和末尾是否保留；这不保证外部招聘系统的阅读顺序。
- 字体和系统打印设置可能改变分页，最终仍需核对打印预览。21 款模板的默认示例均测一页，多页复杂内容使用代表结构，不声称任意内容都能放入固定页数。
- 页数测量使用与打印同高、同避跨页规则的浏览器分栏碎片。不能改回“连续画布高度 ÷ 纸张高度”：打印边距和条目避跨页会让这种算法少算页数。
