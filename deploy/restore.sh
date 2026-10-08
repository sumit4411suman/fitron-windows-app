#!/usr/bin/env bash
# Put a backup back: bash deploy/restore.sh deploy/backups/fitron-20261001-2030.dump
# Replaces everything in the database (and member files, if the matching -files.tar.gz exists).
set -euo pipefail
cd "$(dirname "$0")"
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
dump=${1:?Give the .dump file to restore}
[ -f "$dump" ] || { echo "No such file: $dump"; exit 1; }
# A hosted database (EXTERNAL_DATABASE_URL in .env, README step 11) is restored from a one-off scheduler container: it has
# pg_restore, the connection string and the certificate folder. Only the public schema (Fitron's tables) is put back.
# Read before anything is stopped. The "|| true" matters: most servers have no such line, grep then finds nothing, and
# under "set -e" that would end the script.
ext=$(grep -s '^EXTERNAL_DATABASE_URL=' .env | tail -1 | cut -d= -f2- | sed -e "s/^['\"]//" -e "s/['\"]\$//") || true
read -r -p "This replaces ALL current data with $dump. Type RESTORE to continue: " ok
[ "$ok" = RESTORE ] || exit 1
$DOCKER compose stop app scheduler
if [ -n "$ext" ]; then
  $DOCKER compose run --rm -T --no-deps --entrypoint sh scheduler -c 'pg_restore -d "$EXTERNAL_DATABASE_URL" --clean --if-exists --no-owner --no-acl -n public' < "$dump"
else
  $DOCKER compose exec -T db pg_restore -U fitron -d fitron --clean --if-exists --no-owner < "$dump"
fi
files="${dump%.dump}-files.tar.gz"
if [ -f "$files" ]; then
  $DOCKER compose run --rm -T --no-deps --entrypoint sh -v "$(realpath "$files"):/restore.tgz:ro" app -c "rm -rf /data/storage/* && tar -xzf /restore.tgz -C /data"
fi
$DOCKER compose up -d
echo "Restored."
