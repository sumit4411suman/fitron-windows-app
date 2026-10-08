#!/usr/bin/env bash
# Get the latest Fitron from GitHub and restart with it. Database changes apply on start.
# Also run this after editing deploy/.env.
set -euo pipefail
cd "$(dirname "$0")"
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
git -C .. pull --ff-only
$DOCKER compose up -d --build
# The scheduler runs deploy/scheduler.sh from a mounted file. `up` leaves a container alone when only that file changed,
# so without this a new scheduled job (the weekly restore test, say) would not start until the server was next restarted.
$DOCKER compose restart scheduler
$DOCKER image prune -f >/dev/null
echo "Updated. Check: $DOCKER compose ps"
