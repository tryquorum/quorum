# Workspace — known risks (recorded, not fixed yet)

From the independent review of main ce5155e (GO-WITH-FIXES). Items 1–10 were fixed on lane/workspace; these are written down so the next lane can pick them up. Each entry says what happens, where, and what a fix would look like.

## Direction Board write echo
When `QUORUM_BOARD_WRITE=1`, the council posts results and decisions to Direction Board (`src/engine/live.ts` boardPost/boardDecide, the board executor). The read-only importer (`src/workspace/board-import.ts`) then reads them back from 3070 as new copies, so one council result can show up twice in /w (as the council signal and as a "from Direction Board" copy). Writes are off by default. Fix: tag Quorum-authored board items/signals (e.g. source "quorum") and skip them on import.

## /api/changes is capped at 2000 rows
Direction Board answers `GET /api/changes?since=<seq>` with at most 2000 rows (`board/apps/server/server.ts` `LIMIT 2000`). The importer advances `seq` to the returned value and never notices it missed rows when more than 2000 changed. Fix: when 2000 rows come back, do a full `/api/state` read on the next tick.

## Sample signals are imported
Direction Board marks demo signals with `sample: true`. `upsertBoardSignal` copies them like real ones, so a fresh board's samples appear in Needs you. Fix: skip `s.sample` in `upsertBoardSignal`.

## Moving an item between boards
Copies are keyed by `boardId:id`. An item moved to another board arrives through `/api/changes` as a new key; the old copy stays until the next full `/api/state` read deletes it. Both show briefly. Fix: key by item id alone when ids are global, or delete the old key when the same id appears under another board.

## Dates are normalized silently
Quick capture reads Korean dates ("내일 3시") with `when.ts` and stores the title without the date words. The original text is kept in `raw`, the capture bar previews the parsed date before saving, the toast says "Saved · due …", and the popup shows "You wrote: …". What is not done: a list row does not mark that the date was parsed, so a wrong guess is only visible in the popup. Fix: show a small "parsed" marker on rows whose `raw` differs from `text`.

## 5-second polling has no in-flight guard
`useWorkspaceData` (`site/web/src/workspace/workspace.tsx`) reloads every 5 seconds without checking whether the previous reload finished. On a slow server, responses can overlap and an older response can land after a newer one. Fix: skip a tick while a reload is pending and drop responses older than the latest request.

## Title edits reset on refresh
The popup copies the title into local state on every load (`detail.tsx` `setTitle(d.item.text)`). A background refresh (after any action in the popup) replaces a title being typed but not yet saved. Fix: only set the title when the popup opens or after a save, the same way the note keeps the draft.

## Two server processes on one state directory
The server assumes one process per state directory (`.quorum/`), the same assumption `Store.interruptRunning` makes. Approval runs that a process is waiting on live only in that process's memory (`LIVE_EXEC` in `src/workspace/api.ts`). If a second OS process starts on the same directory, it sees the first one's running approvals as interrupted, moves them to Needs you, and a Retry there could start a second paid run while the first is still going. Fix: hold a lock file in the state directory at start, or record the owning process id with each running approval and only recover approvals whose owner is gone.

## Fixed after the re-review (for the record)
- GET of a signal no longer writes anything: council signals get their approval fence when they are ingested (`withFence` in `src/workspace/signals.ts`); older rows still get one on first use.
- Pass verdicts whose run ended with an error (server restart) come back to Needs you as interrupted, so Retry works.
- A late executor result after the 20-minute timeout is appended to the note as "늦게 도착한 결과"; the timeout reason warns that the first run may still be running.
