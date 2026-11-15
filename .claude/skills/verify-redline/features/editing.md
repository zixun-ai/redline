# 直接编辑、左栏和版本

用户无需 Key 即可修改画布正文、填写占位符和整理模块。批注引用保留所选范围，多个批注可逐条定位。版本与照片调整均先核对再保存。

## Sub-features

- `manual-edit` 组件菜单“直接编辑”及双击修改正文，保留节点 ID；原文已变化时拒绝过期保存。
- `manual-placeholder` 点击或键盘激活待填写标记，填入内容后可撤销。
- `quote-range` 标题、副标题、含 Markdown 的文字和跨段选择保留引用范围；无法可靠映射时不给错误精确范围。
- `pin-group` 同一目标的多个批注聚合显示，可逐条定位。
- `proposal-row` 逐行微调及部分接受；删除行不能当作新增正文保存，修改后重新核对事实。
- `content-sort` 模块、条目和要点都有独立拖动手柄与移动按钮，支持撤销；拒绝外部、跨层和过期拖拽。
- `version-compare` 保存、重命名、对比正文与版式差异、恢复；关闭对比后焦点返回触发按钮。
- `photo-crop` 选择照片后拖动、缩放、复位或用方向按钮调整；保存输出 300 × 420，取消与过期解码均不改照片。
- `design-controls` 页数限制、界面深浅色、标签语言、照片形状和模块主栏/侧栏位置。

## How to get to it (user POV)

- 点击或双击简历正文；点击待填写标记；选中标题或跨段文字后写批注。
- 左栏“内容”使用手柄、移动按钮或全部展开/收起；“版本”保存、重命名、对比和恢复。
- 左栏添加或更换证件照，在调整弹窗预览后保存；“版式”选择外观与页面设置。

## Driving it with core-flow

- `node e2e/editor-upgrades.mjs`：必须通过 `manual_without_key`、`manual_item_and_section`、`placeholder_fill`、`manual_stale_guard`、`title_subtitle_quote`、`quote_fallback`、`quote_across_markup_and_paragraphs`、`aggregated_pins`、`editable_rows`、`deleted_row_edit`、`job_history`。
- `node e2e/leftpanel-upgrades.mjs`：必须通过 `sorting`、`versions`、`photo`、`photoLateDecode`、`controls`。
- 输出分别由 `EDITOR_OUT`、`LEFTPANEL_UPGRADES_OUT` 指定；报告都带构建 SHA-256。前者文件是 `results.json`，案例字段为 `name`、`passed`；后者是 `report.json`，字段为 `id`、`status`。

## Gotchas

- 操作必须走界面。存储仅用于结果核对，复杂样例通过备份恢复入口加载。
- 直接编辑保留 ID，所以仅数节点不足以证明修改成功；同时核对画布和存储正文。
- 标签语言只改内置标签，不翻译正文。界面深色不把简历纸面变黑。
- 拖拽不能替代键盘按钮；照片方向按钮和鼠标拖动使用相同裁切边界。
- 验证模板节点时包括条目标题的 `__title` 节点。新增引用目标后，预期节点集合也要同步，不能删除完整性检查。
