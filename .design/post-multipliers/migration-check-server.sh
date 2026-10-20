#!/bin/sh
# usage (migration-check.js): migration-check-server.sh <server dir> <data dir> <port>  — the stub-mail server, no Google writes.
cd "$1" && DATA_DIR="$2" PORT="$3" GOOGLE_CALENDAR_WRITE=0 CORS_ORIGINS="http://localhost:5173,http://localhost:5199" \
  COOKIE_SAMESITE=none COOKIE_SECURE=1 APP_URL=http://localhost:5173/ exec node scripts/dev-stub-mail.js
