#!/bin/zsh
# gbrain with its own home, so the demo server only ever sees the demo's verdicts (never the personal brain in ~/.gbrain).
QVF_ROOT="${QVF_ROOT:-${0:A:h:h:h}}"
export HOME="${QVF_GBRAIN_HOME:-/Users/jun/.cache/quorum-video-demo/gbrain-home-film}"
exec /Users/jun/.bun/bin/gbrain "$@"
