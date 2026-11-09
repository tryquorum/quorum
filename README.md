# Quorum

**An agent parliament that only does what you need.** Bots propose work, argue it down, and only what survives runs: browser work through [Aside](https://aside.com), code through Codex CLI. [gbrain](https://github.com/garrytan/gbrain) remembers every verdict so the next similar call is instant, and [gstack](https://github.com/garrytan/gstack) roles (CEO, reviewer, QA, CSO) do the arguing. People see the result on Direction Board (방향판).

Built at c0mpiled-17: Seoul (2026-11-09) for YC RFS **Multiplayer AI** and **Self-Maintaining APIs**.

Built on: Aside, gbrain (MIT), gstack (MIT), Direction Board. `board/` is the Direction Board codebase (commit 2ee6e8a), imported as the base and extended here; Aside, gbrain and gstack are used as external tools.

```bash
bun run dev   # http://localhost:4317
bun test
```
