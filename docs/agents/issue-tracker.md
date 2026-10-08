# Issue tracker: GitHub

仓库：ChisaAlter/WhaleIsle。使用 gh CLI 读写 GitHub Issues，
命令显式指定 --repo ChisaAlter/WhaleIsle。

GitHub 是任务状态的记录位置。处理相关议题时，先读取最新内容，
及时同步需求变化、实际进展、阻塞和完成结果，不维护重复本地台账。
同步失败时如实报告，不能将未同步的状态说成已同步。

- 发布任务：gh issue create
- 读取任务：gh issue view
- 查找任务：gh issue list
- 更新内容、标签或负责人：gh issue edit
- 补充进展：gh issue comment
- 完成任务：gh issue close

多行正文写入临时文件，通过 --body-file 提交。
具体标签映射见 triage-labels.md。

PRs as a request surface: no.

开发、PR 和合并流程遵循 ../maintenance/README.md。
