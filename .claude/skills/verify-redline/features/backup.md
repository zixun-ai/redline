# 备份恢复

用户把简历、批注和版本下载成 JSON 文件，之后从文件恢复。备份不含 API Key，无效文件不会改变当前内容。

## Sub-features

- `backup-download` 下载的文件包含当前简历和批注。
- `backup-no-key` 备份文件里没有 API Key。
- `backup-invalid` 无效文件被拒绝，当前内容不变。
- `backup-size` 恢复文件最多 10 MB，超限在读取前拒绝。
- `backup-restore` 恢复后简历和批注都与备份一致。

## How to get to it (user POV)

- 左栏“版本”页的“下载备份”。
- 左栏“版本”页的“从备份恢复”，选择 JSON 文件。

## Driving it with core-flow

Preconditions:

- 基线前提满足。旅程先接受一处修改，备份后再加一条批注并新建空白简历。

- **下载、拒绝、恢复。** 运行 `node .claude/skills/verify-redline/scripts/core-flow.mjs backup`。输出 `PASSED backup`，证据里有 `backup/backup.json`、`backup/invalid-backup.json` 和 `backup-restored` 截图。

## Gotchas

- 新建空白简历不清空批注。恢复前要让批注和备份不同，否则“恢复批注”的检查证明不了任何事。备份后那条批注就是为此添加的。
- 文件输入框是隐藏的，用 `input[type=file][accept=".json"]` 配合 `setInputFiles`。
- 备份后点击简历会切回“内容”页，继续操作前要重新点“版本”。
