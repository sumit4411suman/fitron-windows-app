#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then echo "Install Node.js LTS from https://nodejs.org, then open this file again."; open https://nodejs.org/en/download; read -n1; exit; fi
[ -d node_modules ] || { echo "First run: installing (2-3 min)..."; npm install --omit=dev; }
echo "Now open Fitron > Settings > WhatsApp > Link WhatsApp and scan the QR. Keep this window open."
node server.js
