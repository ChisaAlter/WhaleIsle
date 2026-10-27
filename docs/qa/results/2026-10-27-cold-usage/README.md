# Cold usage-statistics storage measurement

One paired Windows measurement reduced exact overview time from **179.4 seconds to 160.6 seconds**, an observed reduction of **18.9 seconds (10.5%)**. Both runs read the same 604-session private corpus successfully. This is a modest storage optimization; the remaining 160-second cold scan still has substantial JSON parsing, decompression, validation, and restoration work.

[Machine-readable measurements](metrics.json) contain aggregate counts and timing only. Session identities, message content, private paths, raw CPU profiles, and gateway ledger contents are excluded.

## Setup and result

The QA app used Electron 44.9.1, the same isolated profile, and 604 current-generation Zstandard logs containing 1,173,672,902 physical bytes and 2,407,971 decoded events. Each run started a fresh Host process and requested an exact forced overview. Other builds and the Android emulator were stopped for the measurement window. The baseline runtime was backed up; the candidate replaced only the built JSONL persistence entry. Its loaded prototype was checked before the scan. Cordis proxy-bound method strings were not used to identify the implementation.

| Observation | Before | After |
| --- | ---: | ---: |
| Exact overview | 179,416.9 ms | 160,552 ms |
| Sessions read successfully | 604 | 604 |
| Failed / pending | 0 / 0 | 0 / 0 |
| Main sessions with usage | 593 | 593 |
| Retries | 162 | 162 |
| Compaction tokens | 91,088,433 | 91,088,433 |
| Sampled highest RSS | 2,736,099,328 bytes | 2,524,274,688 bytes |
| Sampled highest heap used | 1,966,730,512 bytes | 1,918,842,344 bytes |
| Settled RSS | 2,364,948,480 bytes | 2,286,669,824 bytes |
| Settled heap used | 327,215,184 bytes | 315,632,656 bytes |
| New session during scan | 901 ms | 120 ms |
| Open settings during scan | 114 ms | 87 ms |
| Open general settings during scan | 247 ms | 209 ms |
| Largest observed page scheduling gap | 194.1 ms | 103.1 ms |

This single pair measures the two changes together and does not isolate their individual contributions. Memory was sampled every five seconds. The highest samples are not instantaneous process peaks. The sampled highest RSS fell by 7.74%, sampled highest heap by 2.43%, settled RSS by 3.31%, and settled heap by 3.54%. The interaction timings are individual observations during each scan, not latency distributions or guarantees.

The optional Magpie ledger continued to receive external requests between runs. Its headline totals were therefore not compared for equality. The static log corpus, successful-read coverage, retries, and compaction counts provide the comparable data here. An earlier 573-second observation occurred under different runtime conditions; the change must not be described as reducing 573 seconds to 160 seconds.

## Implemented work

Point lookups check independent project directories through the existing concurrency limiter. Every lookup still checks all projects, selects the highest canonical generation, rejects duplicate ids and unsupported artifacts, and reports the first failure in project order after all checks settle. No path cache was added.

Event adoption still validates each decoded event and deeply freezes its identified message. The JSONL provider freezes the remainder of the graph without traversing that message again. Plugin-owned opaque data still receives a full traversal. Full tail, row-admission, corruption, source-identity, cancellation, and restoration validation remain in place. This change does not alter raw logs, usage accounting, public method signatures, or projection-cache behavior.

## Validation

- JSONL behavior suite: **193 passed**, including nested immutable messages, opaque plugin JSON, bounded point lookups, failure ordering, current and historical generations, foreign writes, changed revisions, monotonic reads, tail recovery, corruption, deletion, and cancellation. The final Windows run used a 15-second worker-test timeout allowance and one worker.
- Zstandard suite: **53 passed**.
- Content admission suite: **48 passed**.
- Affected package and referenced TypeScript projects compiled successfully with `tsc -b`.
- The package-local `tsdown` build emitted the Host runtime successfully.

A batch UTF-8 scanner experiment showed no stable gain and was reverted. A selected-projection experiment was kept outside this candidate because existing checkpoints made all projection hydration about 1.3 seconds in a separate fully composed baseline. A candidate corpus run made during concurrent Gradle compilation and emulator startup was cancelled and excluded from performance comparison.
