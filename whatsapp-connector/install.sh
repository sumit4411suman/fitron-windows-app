#!/usr/bin/env bash
# One-time setup of the Fitron WhatsApp connector on a fresh Ubuntu server (22.04 or 24.04, x86 or ARM; 1 GB RAM is enough,
# e.g. the free Google Cloud e2-micro or Oracle Cloud Always Free).
# Run from the cloned repo:  bash whatsapp-connector/install.sh
# Safe to run again: it keeps an existing .env (and so every gym's WhatsApp link) and only fills in what is missing.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
env_value() { sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '"\r'; }
set_value() { sed -i "s|^$1=.*|$1=$2|" .env; }

if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker…"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi
DOCKER="docker"
docker info >/dev/null 2>&1 || DOCKER="sudo docker"

# Small free servers (Google Cloud e2-micro: 1 GB RAM) run out of memory building the image and running Postgres, Redis and
# two Node processes. A 2 GB swap file makes room; it stays across reboots.
MEM_KB=$(awk '/MemTotal/{print $2}' /proc/meminfo)
SWAP_KB=$(awk '/SwapTotal/{print $2}' /proc/meminfo)
if [ "$MEM_KB" -lt 2000000 ] && [ "$SWAP_KB" -lt 1000000 ] && [ ! -f /swapfile ]; then
  say "Adding 2 GB of swap (this server has $((MEM_KB / 1024)) MB of RAM)…"
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# Oracle Cloud's Ubuntu images block web traffic in the server's own firewall; ufw may too. Open 80 and 443.
if sudo iptables -L INPUT -n 2>/dev/null | grep -q "REJECT"; then
  say "Opening ports 80 and 443 in the server firewall…"
  for p in 80 443; do
    sudo iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport "$p" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null 2>&1; then sudo netfilter-persistent save; else
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null && sudo netfilter-persistent save; fi
fi
if command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -q "Status: active"; then
  sudo ufw allow 80/tcp >/dev/null && sudo ufw allow 443/tcp >/dev/null
fi

if [ ! -f .env ]; then
  say "The connector's web address"
  echo "A domain (or subdomain) whose DNS A record points to this server, e.g. wa-api.fitron.in"
  read -r -p "Domain [wa-api.fitron.in]: " DOMAIN
  DOMAIN=${DOMAIN:-wa-api.fitron.in}; DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN%%/*}
  read -r -p "Email for the HTTPS certificate (Let's Encrypt): " EMAIL
  [ -n "$EMAIL" ] || { echo "An email is needed for the certificate."; exit 1; }
  read -r -p "Fitron app address [https://www.fitron.in]: " APP
  APP=${APP:-https://www.fitron.in}

  cp .env.example .env
  chmod 600 .env
  DB=$(openssl rand -hex 24)
  sed -i "s|CHANGE_ME_DB_PASSWORD|$DB|g" .env
  set_value WA_CONNECTOR_MASTER_KEY "$(openssl rand -hex 32)"
  set_value SESSION_ENCRYPTION_KEY "$(openssl rand -hex 32)"
  set_value DOMAIN "$DOMAIN"
  set_value PUBLIC_URL "https://$DOMAIN"
  set_value LETSENCRYPT_EMAIL "$EMAIL"
  set_value CORS_ORIGIN "$APP"
  echo "Saved .env (keep it: SESSION_ENCRYPTION_KEY unlocks every gym's WhatsApp login)."
fi
DOMAIN=$(env_value DOMAIN)
if [ "$(env_value WA_ENGINE)" = "wwebjs" ] && [ "$MEM_KB" -lt 2000000 ]; then
  say "Note: WA_ENGINE=wwebjs runs a Chromium per linked gym (about 300-500 MB each) and this server has $((MEM_KB / 1024)) MB of RAM."
  echo "One gym fits with the swap file, slowly. For more gyms use a bigger server, or set WA_ENGINE=baileys in .env (no browser)."
fi

# Let's Encrypt can only issue the certificate once the domain points here.
ME=$(curl -fsS4 https://api.ipify.org 2>/dev/null || true)
DNS=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')
if [ -n "$ME" ] && [ "$DNS" != "$ME" ]; then
  say "Warning: $DOMAIN points to ${DNS:-nothing}, but this server is $ME."
  echo "Add a DNS A record: $DOMAIN -> $ME, wait a few minutes, then run this script again."
  exit 1
fi

say "Building and starting the connector (a few minutes the first time)…"
$DOCKER compose up -d --build app worker postgres redis
for _ in $(seq 1 60); do
  $DOCKER compose exec -T app node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 && break
  sleep 5
done

if ! curl -fsS --max-time 10 "https://$DOMAIN/health" >/dev/null 2>&1; then
  say "Getting the HTTPS certificate…"
  sh docker/init-https.sh
fi

say "Checking https://$DOMAIN/health"
curl -fsS --max-time 10 "https://$DOMAIN/health" && echo

say "Done. Now in Vercel (Fitron project › Settings › Environment Variables, Production) add:"
echo "  WA_CONNECTOR_URL = https://$DOMAIN"
echo "  WA_CONNECTOR_KEY = $(env_value WA_CONNECTOR_MASTER_KEY)"
echo "Then redeploy Fitron, open Settings › WhatsApp › Link WhatsApp and scan the QR from the gym phone."
echo "Keep that key secret: it is the connector's admin key."
