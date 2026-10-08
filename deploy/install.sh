#!/usr/bin/env bash
# One-time setup of Fitron on a fresh Ubuntu server (22.04 or 24.04, x86 or ARM).
# Run from the cloned repo:  bash deploy/install.sh
# Safe to run again: it keeps an existing deploy/.env and only creates the gym if you ask.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
rand() { openssl rand -hex "${1:-24}"; }

if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker…"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi
DOCKER="docker"
docker info >/dev/null 2>&1 || DOCKER="sudo docker"

# Oracle Cloud's Ubuntu images block web traffic in the server's own firewall. Open 80 and 443.
if sudo iptables -L INPUT -n 2>/dev/null | grep -q "REJECT"; then
  say "Opening ports 80 and 443 in the server firewall…"
  for p in 80 443; do
    sudo iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport "$p" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null 2>&1; then sudo netfilter-persistent save; else
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null && sudo netfilter-persistent save; fi
fi

if [ ! -f .env ]; then
  say "Your web address"
  echo "The domain that points to this server, e.g. fitron.in, app.yourgym.in or yourgym.duckdns.org"
  read -r -p "Domain: " DOMAIN
  DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN%%/*}; DOMAIN=${DOMAIN#www.}
  [ -n "$DOMAIN" ] || { echo "A domain is needed for HTTPS."; exit 1; }

  say "The FITRON team login"
  echo "Gyms and AI Trainer members pay FITRON through Razorpay: add your FITRON_RAZORPAY_* keys afterwards (step 10 of deploy/README.md)."
  echo "Until then FITRON runs in demo mode (nothing is charged). The email below opens the FITRON team console, and gets the server's error alerts."
  ADMIN=""
  while :; do
    read -r -p "Your email (leave empty to skip; use the same one for your login below): " ADMIN
    ADMIN=$(printf '%s' "$ADMIN" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
    [ -z "$ADMIN" ] || [[ "$ADMIN" =~ ^[^@|]+@[^@|]+\.[^@|]+$ ]] && break
    echo "Please type a valid email."
  done

  # Every setting from .env.example, blank, then the ones we can generate.
  grep -E '^[A-Z_]+=' ../.env.example | grep -v '^DATABASE_URL=' | sed -E 's/=.*/=/' > .env
  set_env() { sed -i "s|^$1=.*|$1=$2|" .env; grep -q "^$1=" .env || echo "$1=$2" >> .env; }
  set_env DOMAIN "$DOMAIN"
  set_env POSTGRES_PASSWORD "$(rand 24)"
  set_env CRON_SECRET "$(rand 32)"
  set_env AUTH_SECRET "$(rand 32)"
  set_env BIOMETRIC_KEY "$(rand 32)"
  # Web Push (AI Trainer reminders): a P-256 key pair, as VAPID wants it (base64url, 65-byte public point, 32-byte private scalar).
  b64url() { base64 -w0 | tr '+/' '-_' | tr -d '='; }
  openssl ecparam -name prime256v1 -genkey -noout -out vapid.pem
  set_env VAPID_PUBLIC_KEY "$(openssl ec -in vapid.pem -pubout -outform DER 2>/dev/null | tail -c 65 | b64url)"
  set_env VAPID_PRIVATE_KEY "$(openssl ec -in vapid.pem -outform DER 2>/dev/null | tail -c +8 | head -c 32 | b64url)"
  rm -f vapid.pem
  set_env VAPID_SUBJECT "mailto:hello@fitron.in"
  set_env WHATSAPP_VERIFY_TOKEN "$(rand 16)"
  set_env AI_MODEL "claude-sonnet-5"
  set_env FITRON_LEGAL_NAME "Fitron Technologies"
  set_env FITRON_ADMIN_EMAILS "$ADMIN"
  set_env ERROR_ALERT_TO "$ADMIN"
  set_env MAIL_FROM '"FITRON <hello@fitron.in>"'
  set_env ENQUIRY_TO "hello@fitron.in"
  set_env BACKUP_KEEP_DAYS 14
  chmod 600 .env
  echo "Saved settings to deploy/.env (passwords and keys were generated for you)."
fi
mkdir -p backups certs

say "Building and starting Fitron (the first build takes a few minutes)…"
$DOCKER compose up -d --build

say "Waiting for the app to answer…"
for _ in $(seq 1 60); do
  if $DOCKER compose exec -T app node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then ok=1; break; fi
  sleep 5
done
[ "${ok:-}" = 1 ] || { echo "The app didn't start. See: $DOCKER compose logs app"; exit 1; }

DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)
read -r -p "Create your gym and owner account now? [Y/n] " yn
if [ "${yn:-Y}" != "n" ] && [ "${yn:-Y}" != "N" ]; then
  read -r -p "Gym name: " GYM
  read -r -p "First branch name [Main]: " BRANCH
  read -r -p "Your name: " NAME
  read -r -p "Your email (you'll sign in with it): " EMAIL
  read -r -p "Your mobile (10 digits): " PHONE
  read -r -s -p "Password (at least 10 characters): " PASS; echo
  $DOCKER compose exec -T app npm run -s setup -- --gym "$GYM" --branch "${BRANCH:-Main}" --name "$NAME" --email "$EMAIL" --phone "$PHONE" --password "$PASS"
fi

say "Done. Open https://$DOMAIN"
echo "Settings: deploy/.env (edit, then run: bash deploy/update.sh)"
echo "Backups:  deploy/backups (nightly, kept 14 days). Copy them off the server now and then."
