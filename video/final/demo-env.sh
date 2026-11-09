# Demo server environment for the final film (lane/video-final). Source it with: set -a; source video/final/demo-env.sh; set +a
# Isolated from personal data: fresh state dir, no Direction Board (read or write), its own gbrain brain and recipes DB.
# Aside stays on for the one real council run (paid); the request names only public pages. No secrets here.
QVF_ROOT="${QVF_ROOT:-$PWD}"
QUORUM_STATE_DIR="${QVF_STATE:-$QVF_ROOT/video/tmp/state}"
QUORUM_PORT=4331
QUORUM_HOST=127.0.0.1
QUORUM_PUBLIC_PORT=
PUBLIC_ORIGIN=
ACCESS_TEAM=
ACCESS_AUD=
ALLOWED_EMAILS=
QUORUM_BOARD_IMPORT=0
QUORUM_BOARD_URL=http://127.0.0.1:9
DIRECTION_TOKEN=
QUORUM_BOARD_WRITE=0
QUORUM_RECIPES_DB="$QUORUM_STATE_DIR/recipes.db"
GBRAIN_BIN="$QVF_ROOT/video/final/gbrain-demo.sh"
QUORUM_GBRAIN_BIN="$QVF_ROOT/video/final/gbrain-demo.sh"
QUORUM_ASIDE=1
QUORUM_RECIPE_ASIDE=0
QUORUM_MCP_PROPOSE=1
