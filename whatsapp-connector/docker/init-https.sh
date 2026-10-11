#!/bin/sh
# First-time HTTPS setup: gets the Let's Encrypt certificate for $DOMAIN, then starts nginx with it.
# Run once from the whatsapp-connector folder after `docker compose up -d app worker postgres redis`:
#   sh docker/init-https.sh
set -e
# Read only the two values needed: .env is not a shell script (values such as "OPT OUT" have spaces).
env_value() { sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '"\r'; }
DOMAIN=$(env_value DOMAIN)
LETSENCRYPT_EMAIL=$(env_value LETSENCRYPT_EMAIL)
: "${DOMAIN:?DOMAIN must be set in .env}"
: "${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL must be set in .env}"

# nginx needs a certificate file to start its HTTPS server; begin with a short-lived self-signed one.
docker compose run --rm --entrypoint sh certbot -c "
  mkdir -p /etc/letsencrypt/live/$DOMAIN &&
  [ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ] ||
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj '/CN=$DOMAIN' \
    -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem"
docker compose up -d nginx
# Replace it with a real certificate over the ACME HTTP challenge.
docker compose run --rm --entrypoint sh certbot -c "
  rm -rf /etc/letsencrypt/live/$DOMAIN /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf 2>/dev/null;
  certbot certonly --webroot -w /var/www/certbot -d $DOMAIN --email $LETSENCRYPT_EMAIL --agree-tos --no-eff-email --non-interactive"
docker compose exec nginx nginx -s reload
docker compose up -d certbot
echo "HTTPS is ready: https://$DOMAIN/health"
