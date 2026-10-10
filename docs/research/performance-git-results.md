# T14 Git 并发 fetch 性能结果

目标目录：`C:/AI/WhaleIsle-application-performance`，分支 `codex/application-performance-full`，基线 `26205a89`。2026-10-09，Node.js v24.19.0。仅使用自有临时 seed / bare remote / linked worktree；没有访问真实用户 remote，没有产品提交、推送、PR，未启动或中断用户实例。

## 采用的改动

`src/main/git-fetch.js:12,43,48,62` 增加按原 common git directory + remote name key 共享的在途 Promise。每个等待者收到相同 `{fetched:true, ok}`，让原 `gitFetchForStatus` (`src/main/git.js:642,668`) 各自丢弃 remote-derived read memo 并读取自己的本地状态；不能将 follower 标为 `fetched:false`，否则已有 status memo 可能保留 fetch 前的 ahead/behind。

保留原 15 秒成功冷却、失败 30 秒起指数退避（上限 15 分钟）、5 秒 fetch timeout、tracking remote 优先及 primary remote fallback。时间戳仍从 fetch 开始时计算。成功、非零退出或异常都会释放在途项；`resetFetchCooldowns` 只清 completed cooldown，不取消或丢弃正在工作的 fetch。未改变 per-owner / worktree 的 read context 身份、权限授权、本地 status 重新读取、PTY、输出背压、固定轮询或任务生命周期。

未采用：仓库全局本地 status 缓存、跨 remote 名称合并、用冷却阻止新的 local status、取消较早 fetch 或新增 fetch worker。

## 同条件真实 Git 对照

先单次原实现取样证实八路刷新产生 8 次 fetch；然后同一 Node 进程、同一自有本地 bare remote、两个共享 common-dir 的 worktree，三次成对 baseline / candidate，执行顺序交替。八个调用交替进入两个 worktree，用真实 `runGit`，没有 barrier、伪造 metadata runner 或 fetch stub。baseline 源码通过 `git show 26205a89:src/main/git-fetch.js` 独立装载；双方使用相同、未修改的 Git exec/remotes 依赖。

计时范围为八个 `fetchForStatus` 并发调用全部完成，不含仓库构造、结果解析或删除。每次调用前清各实现的 completed cooldown。通过临时 `GIT_TRACE2_EVENT` 文件统计 `event=start` 且 argv[1]=fetch 的真实进程数；`gitStarts` 也包括 fetch 的 Git 子进程，不等于仅 Electron 直接 spawn 数。没有公网、SSH、凭据或网络延迟。

| 指标 | 原实现 | 候选 |
| --- | ---: | ---: |
| 请求数 / worktree 数 | 8 / 2 | 8 / 2 |
| 每组真实 fetch 次数 | 8 | 1 |
| 每组 Trace2 Git start 总数 | 56 | 28 |
| 三组总等待中位 | 1199.775ms | 869.132ms |
| 三组范围 | 1192.067–1362.710ms | 859.730–898.185ms |

总等待中位减少 27.6%；每一组八个返回值都为 `{fetched:true,ok:true}`。这证明相同 key 的并发实际重复工作被去除，不证明真实 titlebar 的端到端延迟、网络体验或整应用速度相同幅度改善。metadata 读取仍按原 read seam / read context，不新增跨刷新缓存。

## 产品后验证与用户行为边界

`src/main/git.test.js:2149,2241,2281,2310` 定向四项通过，零 skip；新增的失败检查补入 local status 后单独重跑通过。执行入口：

```powershell
node --test --test-name-pattern="concurrent status fetch|shared status fetch|one titlebar refresh" src/main/git.test.js
```

- 已有 steady-state titlebar refresh 仍只做一次 porcelain 和一次 numstat。
- 两个 linked worktree、不同 owner 先持有旧状态，再从 seed 更新自有 bare remote；共享 fetch 后两个 owner 都看到 behind=1，各自工作区 dirty 内容仍存在。随后外部写入新文件，新 local refresh 和 cooldown 内 fetch-status 都看到该文件。
- 同 common-dir 的 origin / backup、不同 common-dir 的 origin 仍产生三个独立 fetch，没有混淆 remote / worktree 状态。
- 不存在的自有 local remote 产生共享失败；失败后本地 dirty status 仍可读。 fake Date.now 只位于测试进程，用真实 Git 验证 30/60/120/240/480/900/900 秒退避、边界释放、恢复后 14999ms 跳过 / 15000ms 再 fetch；不通过长时间睡眠取样。
- `git diff --check` 通过。一次性 profile 源和临时仓库已删除，下方保留原始测量数据。

实际用户路径未验：真实 Electron 多窗口 focus/visibility 恢复、网络或认证失败、运行中修改远端配置、安装包组合状态和可见 titlebar 行为。自有仓库真实 Git/原公共函数检查不能替代最终应用 UI；根代理负责最终候选的真实运行与画面验收。这里只完成 T14 的 Git 子项，PTY 性能未在本次改动或检查范围。

## 测量 JSON

```json
{
  "node": "v24.19.0",
  "requests": 8,
  "worktrees": 2,
  "remote": "owned local bare repository",
  "readSeam": "real runGit without barrier",
  "runs": [
    {
      "variant": "baseline",
      "sample": 0,
      "durationMs": 1362.7103,
      "gitStarts": 56,
      "fetchStarts": 8,
      "results": [
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        }
      ]
    },
    {
      "variant": "candidate",
      "sample": 0,
      "durationMs": 898.1853999999998,
      "gitStarts": 28,
      "fetchStarts": 1,
      "results": [
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        }
      ]
    },
    {
      "variant": "candidate",
      "sample": 1,
      "durationMs": 859.7301000000002,
      "gitStarts": 28,
      "fetchStarts": 1,
      "results": [
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        }
      ]
    },
    {
      "variant": "baseline",
      "sample": 1,
      "durationMs": 1192.0668999999998,
      "gitStarts": 56,
      "fetchStarts": 8,
      "results": [
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        }
      ]
    },
    {
      "variant": "baseline",
      "sample": 2,
      "durationMs": 1199.7750000000005,
      "gitStarts": 56,
      "fetchStarts": 8,
      "results": [
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        }
      ]
    },
    {
      "variant": "candidate",
      "sample": 2,
      "durationMs": 869.1315999999997,
      "gitStarts": 28,
      "fetchStarts": 1,
      "results": [
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        },
        {
          "fetched": true,
          "ok": true
        }
      ]
    }
  ]
}
```
