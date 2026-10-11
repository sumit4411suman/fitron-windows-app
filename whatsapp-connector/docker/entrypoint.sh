#!/bin/sh
# Applies pending database migrations (only the api container does this; RUN_MIGRATIONS=false skips it), then starts.
set -e
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Applying database migrations..."
  npx prisma migrate deploy --schema src/database/prisma/schema.prisma
fi
exec "$@"
