# Fitron WhatsApp connector

Links the gym's WhatsApp by QR code (like WhatsApp Web) so Fitron can send reminders and invoices automatically. No Meta API key.

## Easiest: gym PC, double-click
1. Copy the `connector` folder to the reception PC.
2. Double-click **Start WhatsApp -Windows-.bat** (Mac: **Start WhatsApp -Mac-.command**). First time it offers to install Node.js, then installs itself (2–3 min).
3. In Fitron on the same PC: Settings › WhatsApp › **Link WhatsApp**. The QR appears straight away; scan it from the gym phone (WhatsApp › Linked devices › Link a device). Done.
Keep the black window open (or minimise it). With the default settings only this PC can use the connector.

No settings are needed on the Fitron server for this: when `WA_CONNECTOR_URL` and `WA_CONNECTOR_KEY` are empty, Fitron looks for the connector at `http://127.0.0.1:3131` with the built-in key `fitron-local`, which is exactly what this start file uses. This works when Fitron runs on the same PC (`npm run dev`, `npm start`). It does **not** work when Fitron is hosted online (Vercel, a server): a server cannot reach the PC's `127.0.0.1`. Then host the connector too (next section) and set `WA_CONNECTOR_URL` and `WA_CONNECTOR_KEY` on the Fitron server.

If Fitron runs in Docker on the same PC, set `WA_CONNECTOR_URL=http://host.docker.internal:3131` and `WA_CONNECTOR_KEY=<the FITRON_KEY the connector was started with>` in `deploy/.env`. The connector only accepts other machines once `FITRON_KEY` is set, so start it with `FITRON_KEY` set.

## Always-on server (one connector for every gym)
Use this when Fitron itself is hosted online (Vercel or a server): it cannot reach a PC, so the connector must run on an always-on machine. **One connector serves many gyms.** Each gym owner links her own WhatsApp in Fitron (Settings › WhatsApp › Link WhatsApp), and every reminder, invoice and renewal goes out from that gym's own number to its members. Members never link anything. Each gym has its own queue, its own daily cap and its own delivery results.

Any host that keeps a Docker container or a Node process running works: a VPS, AWS (EC2 or Lightsail), Fly.io, Railway, Render and so on. Pick a machine with about 1 GB of memory for every 2 linked gyms (each linked gym keeps one Chrome open) and a disk that survives restarts.

1. On the server, from this folder: `docker build -t fitron-whatsapp .` then
   ```
   docker run -d --restart always --name fitron-whatsapp -p 3131:3131 \
     -e FITRON_KEY=<a long secret you make up> -e MAX_SESSIONS=20 \
     -v fitron-wa-session:/app/session fitron-whatsapp
   ```
   Without the volume, every gym has to re-link after a restart. Put it behind https (a reverse proxy such as Caddy or nginx, or the host's own https), because the Fitron app calls it from Vercel.
2. On the **Fitron server** (Vercel: Project > Settings > Environment Variables, then redeploy) set:
   ```
   WA_CONNECTOR_URL=https://<the connector's https address>
   WA_CONNECTOR_KEY=<the same FITRON_KEY>
   ```
3. Check: opening the connector's address in a browser should answer `Wrong connector key` (it is running and protected).
4. Each gym owner: Fitron › Settings › WhatsApp › **Link WhatsApp**, scan the QR from the gym phone (WhatsApp › Linked devices › Link a device).

Settings (environment variables): `MAX_SESSIONS` gyms at once (default 20; a full connector says so instead of dropping a gym), `DAILY_CAP` messages a day per gym (default 250), `SESSION_DIR` where the links are kept. A gym that opens the QR and never scans it is closed after 5 minutes; linked gyms come back by themselves after a restart. `render.yaml` here describes the same service for Render if you ever want it.

## Manual setup (terminal)
1. Install Node.js 18 or newer from nodejs.org.
2. Copy this `connector` folder to the PC, open a terminal in it and run:
   ```
   npm install
   set FITRON_KEY=pick-a-long-secret      (Mac/Linux: export FITRON_KEY=pick-a-long-secret)
   npm start
   ```
3. On the Fitron server set `WA_CONNECTOR_URL=http://localhost:3131` and `WA_CONNECTOR_KEY=pick-a-long-secret` (the same key), then restart Fitron.
4. In Fitron › Settings › WhatsApp › Link WhatsApp the real QR appears. On the gym phone: WhatsApp › Linked devices › Link a device › scan.
5. Keep the terminal running (or install as a service with `pm2 start server.js --name fitron-wa`).

## Notes
- Messages go out one every 8–15 seconds per gym, max 250 a day per gym (`DAILY_CAP`).
- Unlink: press Unlink in Fitron, or delete the `session` folder.
- The phone must come online at least every 14 days.
- Unofficial: WhatsApp may restrict numbers that send bulk messages to people who haven't saved the number. Message only your members.
- Fitron talks to the connector from its server, not from the browser, so the connector must be reachable from wherever Fitron runs. For a Fitron hosted online with the connector on a gym PC, expose the PC over https, e.g. `cloudflared tunnel --url http://localhost:3131`, and use that URL as `WA_CONNECTOR_URL`. Running the connector on a server is more reliable.
- The window shows why WhatsApp did not start (no internet, Chrome missing) and keeps retrying; Fitron shows the same reason in the Link WhatsApp dialog. If a message stays "Queued", the connector was probably restarted before it sent it; Fitron marks such messages Failed after 6 hours so they can be sent again.


## UPI Autopay (real recurring debits)
The same connector also runs Fitron's UPI Autopay through **Razorpay Subscriptions**. Set these before starting:

```
RZP_KEY_ID=rzp_live_xxxxxxxx
RZP_KEY_SECRET=xxxxxxxxxxxxxxxx
RZP_WEBHOOK_SECRET=any-long-random-string
```

In the Razorpay dashboard → Webhooks add `https://<your-connector-host>/autopay/webhook` with the secret above and the events
`subscription.authenticated, subscription.activated, subscription.charged, subscription.pending, subscription.halted, subscription.cancelled, subscription.paused, subscription.resumed, payment.failed`.
Webhooks need a public HTTPS address, so run the connector on an https server, not only on the gym PC.

Then in Fitron → Settings → Integrations & AI → UPI autopay choose **Live (Razorpay)**. Creating a mandate sends the member an authorisation link on WhatsApp; once they approve it in any UPI app, Razorpay charges the plan amount on every renewal date, sends the NPCI pre-debit notice, retries failures, and Fitron records the renewal, invoice and payment automatically.
