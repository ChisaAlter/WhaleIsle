# dshbot · ayase / grok-4.6 live smoke — 2026-08-29

Official `@deepseek-ai/dsh@0.1.1-rc.2` + footer Bots fallback UI, with a custom
OpenAI-compatible route (`llm-pi-ai.providers.ayase`) and default model
`ayase` / `grok-4.6`. Credentials were supplied only via process env
(`AYASE_API_KEY`); **not** stored in this tree.

## Results

| Step | Result | Evidence |
| --- | --- | --- |
| Provider reachable | PASS | `GET /v1/models` lists `grok-4.6`; chat completions ping OK |
| Headless one-shot | PASS | reply `GROK_OK` ([dshbot-ayase-headless.txt](dshbot-ayase-headless.txt)) |
| Create bots on official UI | PASS | Alpha + Beta with preview `grok-4.6` ([roster](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-29/dshbot-ayase-roster.png) / [json](dshbot-ayase-roster.json)) |
| 1:1 live turn | PASS | Assistant returned exact `BOT_LIVE_OK` on Grok 4.6 (~11s) ([reply](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-29/dshbot-ayase-reply-final.png) / [json](dshbot-ayase-reply.json)) |
| Group create | PASS | `RoomLive` with Alpha + Beta members ([group-created](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-29/dshbot-ayase-group-created.png)) |
| Group member rotation | PARTIAL | Room opens on blank “choose workspace” surface; automation did not finish a group turn in this pass (model path already proven on 1:1) |

## Notes

- Official blank bot sessions require picking a workspace directory before the
  composer accepts input; 1:1 succeeded after opening `/tmp/dshbot-ws`.
- Do not commit API keys. Rotate the test key if it was pasted into chat.
