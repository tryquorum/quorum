#!/bin/zsh -l
# Terminal.app 에서 돌리는 웹 빌드. Aside 안에서 설치하면 격리 표시가 붙어 네이티브 바이너리(rolldown 등)가 막힘.
cd ~/Developer/direction-board/apps/web || exit 1
LOG=/tmp/direction-board-build.log
run() {
  echo "== start $(date)"
  # Aside 격리 표시가 붙은 bun 캐시 항목은 지워서 새로 받게 한다
  for d in ~/.bun/install/cache/*/ ~/.bun/install/cache/@*/*/; do
    if xattr -r -p com.apple.quarantine "$d" 2>/dev/null | grep -q Aside; then echo "purge cache: $d"; rm -rf "$d"; fi
  done
  rm -rf node_modules
  bun install || return 1
  if xattr -r -p com.apple.quarantine node_modules 2>/dev/null | grep -q Aside; then echo "still quarantined after install"; return 1; fi
  bun run build || return 1
}
if run > $LOG 2>&1; then echo "== BUILD_OK $(date)" >> $LOG; else echo "== BUILD_FAIL $(date)" >> $LOG; fi
tail -4 $LOG
