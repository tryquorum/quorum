#!/bin/zsh -l
# 의존성은 그대로 두고 빌드만 (Terminal.app 에서 실행)
cd ~/Developer/direction-board/apps/web || exit 1
LOG=/tmp/direction-board-build.log
if bun run build > $LOG 2>&1; then echo "== BUILD_OK $(date)" >> $LOG; else echo "== BUILD_FAIL $(date)" >> $LOG; fi
tail -3 $LOG
