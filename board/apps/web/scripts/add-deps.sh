#!/bin/zsh -l
# 의존성 추가 (Terminal.app 에서): apps/web/scripts/add-deps.sh pkg1 pkg2 ...
cd ~/Developer/direction-board/apps/web || exit 1
LOG=/tmp/direction-board-build.log
if bun add "$@" > $LOG 2>&1; then echo "== BUILD_OK deps $(date)" >> $LOG; else echo "== BUILD_FAIL deps $(date)" >> $LOG; fi
tail -3 $LOG
