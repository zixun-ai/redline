# 并发、异步生命周期与保存成本

`node e2e/regressions.mjs` 验证六条回归。可追加 `tabs key saving photo import motion` 中的名称，只运行选定检查。`REDLINE_HTML` 可指定独立构建，`REGRESSION_OUT` 可指定报告目录。默认报告在 `e2e/out/regressions/report.json`，记录 HTML 哈希和 Chrome 版本。

`node e2e/audit-regressions.mjs` 验证本次审查发现的其他边界，包括备份恢复竞态、事务回滚、只读存档、Key 与隐私、定制关闭、预览打印和键盘窄屏。可追加脚本中的案例名称来单独运行，`AUDIT_OUT` 指定证据目录，默认是 `e2e/out/audit-regressions`。发布入口会核对两组报告的 HTML 哈希、非空案例列表和全部通过状态。

## Sub-features

- `tabs`：浏览器独占锁在持久编辑器读取或写入存储前取得。第二个正常页面等待原页关闭，点击“重新打开”后读取最新内容。无法使用锁时，可进入临时编辑；临时页不自动保存到本机。
- `session-fallback`：`simultaneous`、`rejection`、`legacy`、`storageDenied` 四条检查验证临时页隔离、锁拒绝或抛错、旧版数据与存储被禁用。临时页只持有自己的内存状态，可下载备份和 PDF，不能改变其他页的持久存档。
- `key`：输入框 Enter 和按钮共用请求防重。修改输入、移除 Key、关闭弹窗或卸载均使旧验证失效。旧响应不能覆盖新 Key。
- `saving`：简历、批注、版本及岗位匹配摘要与缺项在一个 IndexedDB 事务内保存，只处理已变化或尚未成功保存的对象。原岗位全文不持久保存。未变化版本不重复写入；任一对象写入失败时整批回滚，不留下简历与批注错配的状态。旧 localStorage 数据在首次打开新版时迁移。
- `photo`：上传完成只合并照片到最新文档。新的上传、移除照片、文档替换和卸载使旧回调失效。
- `import`：关闭导入后，旧文件读取不能覆盖新草稿；退出动画期间快速重开也能重新读取。PDF 任务接收取消信号并销毁；文件读取前后检查取消状态。
- 按岗位定制同样在关闭瞬间取消，回包前核对弹窗是否打开、请求身份和取消状态。旧请求的 finally 不得复位新请求。
- `motion`：减弱动效模式不生成页面截图。切换到正常模式后恢复截图和纹理；切回后停止截图调度。动画结束后停止绘制。

## Driving it

```sh
npm run build
node e2e/regressions.mjs
node e2e/audit-regressions.mjs
npm test -- src/lib/files.test.ts
```

检查实际 UI 和 IndexedDB 的保存结果；Key 只有明确勾选记住时才写 localStorage。Key 的 HTTP 响应被截获；照片使用真实解码、导入使用真实 File.text，仅控制完成时序。保存失败应在 IndexedDB 事务中注入并验证整批回滚。截图和纹理调用只计数，不替换实现。

## Gotchas

- 新构建的独占锁只约束使用该锁的页面。更新时先关闭旧版 Redline 编辑页。
- 本地 file:// 构建可能使用 PDF.js 的主线程回退。真实 PDF 正常导入由 `closing-summary` 和 `e2e/features.mjs` 验证。取消任务/释放 URL 的单测使用受控 PDF.js task，覆盖销毁后原读取仍不结束的情况；不能称为真实 worker 存活测量。
- File.text、File.arrayBuffer 和 mammoth 没有应用可用的中断入口；已开始的操作可能完成，但取消后不会继续应用结果。PDF 的 task.destroy 可提前终止任务。
- 文件和照片最多 10 MB。照片还检查 4000 万像素上限，成功或失败后都调用 ImageBitmap.close；像素上限检查发生在解码后，不能证明解码阶段内存没有瞬时增长。
- 修复前 HTML 备份保存在 `e2e/out/perf-fixes-20261109/before.html`。六条主回归在该版本均失败，在修复版本通过。后续新增检查应继续在隔离副本中验证能抓到对应错误。
