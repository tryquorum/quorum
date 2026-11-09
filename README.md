# Quorum

**An agent parliament that only does what you need.** Bots propose work, argue it down, and only what survives runs: browser work through [Aside](https://aside.com), code through Codex CLI. [gbrain](https://github.com/garrytan/gbrain) remembers every verdict so the next similar call is instant, and [gstack](https://github.com/garrytan/gstack) roles (CEO, reviewer, QA, CSO) do the arguing. People see the result on Direction Board (방향판).

## Run it with your own Aside

1. Install [Aside](https://aside.com) on your Mac and sign in. Its CLI lives at `~/.local/bin/aside`; `aside account list` should show one account as signed in.
2. Install [Bun](https://bun.sh) 1.4.4 or newer.
3. Clone and start Quorum. `--open` opens Workspace in your browser:

```bash
git clone https://github.com/tryquorum/quorum && cd quorum && bun run dev -- --open
```

Workspace (http://localhost:4317/w) starts with a connection card and one demo item in Inbox. Press **Send to agent** on it: three bots propose, four reviewers argue, and only what passes runs in your Aside. Anything that sends, pays or posts waits for you under **Needs you**.

- Quorum uses the signed-in Aside account. Set `ASIDE_ACCOUNT=u1` to pick another one.
- gbrain (memory), Codex CLI (code tasks) and Direction Board are optional. Without them the council still runs; the card says what is off and how to turn it on.
- Cost: one council is about 7 Aside runs (3 proposers + 4 reviewers) plus one per passed browser task. `QUORUM_BOT_RUNNER=codex bun run dev` moves the opinions to Codex CLI and keeps Aside for browser work.
- Hosted version and how each person connects their own Aside: [docs/hosted/README.md](docs/hosted/README.md).

Built at c0mpiled-17: Seoul (2026-11-09) for YC RFS **Multiplayer AI** and **Self-Maintaining APIs**.

Built on: Aside, gbrain (MIT), gstack (MIT), Direction Board. `board/` is the Direction Board codebase (commit 2ee6e8a), imported as the base and extended here; Aside, gbrain and gstack are used as external tools.

```bash
bun run dev   # http://localhost:4317
bun test
```
