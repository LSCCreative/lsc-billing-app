#!/bin/sh
# usage (migration-check.js): migration-check-server.sh <server dir> <data dir> <port>  — the stub-mail server, no Google
# writes, and Hnry NOT set up (empty Zapier credentials), so reading a copy can never push to Hnry.
cd "$1" && DATA_DIR="$2" PORT="$3" GOOGLE_CALENDAR_WRITE=0 CORS_ORIGINS="http://localhost:5173,http://localhost:5199" \
  COOKIE_SAMESITE=none COOKIE_SECURE=1 APP_URL=http://localhost:5173/ \
  ZAPIER_CREDENTIALS_CLIENT_ID= ZAPIER_CREDENTIALS_CLIENT_SECRET= exec node scripts/dev-stub-mail.js
