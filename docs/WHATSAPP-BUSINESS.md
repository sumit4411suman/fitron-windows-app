# WhatsApp Business: every gym connects its own number

Each gym owner presses **Connect with Meta** in Settings › WhatsApp, signs in to Facebook, picks or creates a WhatsApp Business
account, and verifies the number by the code Meta sends. Fitron then sends reminders, invoices and renewals to that gym's
members from **that gym's own number**. Members connect nothing. There is no server to run: it works from Vercel.

What Fitron does when a gym connects (`src/lib/services/wa-connect.ts`):

1. Exchanges the pop-up's code for the gym's business token, and reads the number's name and display number.
2. Registers the number for the Cloud API and subscribes the gym's WhatsApp Business account to Fitron's webhook.
3. Submits the gym's message templates (`fitron_welcome`, `fitron_exp7`, `fitron_invoice` and so on, plus `fitron_test`) to Meta
   for approval. Messages that start a conversation can only use an approved template. Approval takes minutes to a day;
   Settings › WhatsApp shows how many are approved, waiting or rejected, and **Resubmit templates to Meta** retries.
4. Stores the token sealed (AES-256-GCM with `BIOMETRIC_KEY`) in Setting `whatsapp_cloud`. It is never shown, never in a backup,
   and **Disconnect** deletes it.

## One-time setup by the Fitron team (a Meta app for all gyms)

This is the only part that cannot be done in code. Expect days, mostly waiting for Meta.

1. **developers.facebook.com › Create app** (type Business) and add the **WhatsApp** product. Verify your business in Meta
   Business Settings (Security center › Business verification).
2. **Become a Tech Provider** (App Dashboard › App Review › Permissions and features) and get Advanced Access for
   `whatsapp_business_management` and `whatsapp_business_messaging`. Without this the Connect pop-up only works for people on the
   app's own team, which is enough to test with one gym.
3. **Facebook Login for Business › Configurations › Create configuration** from the *WhatsApp Embedded Signup* template. Copy its
   **Configuration ID**: that is `META_ES_CONFIG_ID`.
4. **Settings › Basic**: add `fitron.in` to *App domains*. **Facebook Login › Settings**: add `https://fitron.in` under *Allowed
   domains for the JavaScript SDK*, and turn on *Login with the JavaScript SDK*.
5. **WhatsApp › Configuration › Webhooks**: callback URL `https://fitron.in/api/webhooks/whatsapp`, verify token = the value you
   choose for `WHATSAPP_VERIFY_TOKEN`, and subscribe to **messages**.
6. In Vercel › Environment Variables set `META_APP_ID` (App Dashboard › Settings › Basic), `META_ES_CONFIG_ID`,
   `WHATSAPP_APP_SECRET` (the app secret) and `WHATSAPP_VERIFY_TOKEN`, then redeploy. The Connect button appears in the Link
   WhatsApp window once all of them are set.

## Things to tell gym owners

- Use a number that is not busy with the normal WhatsApp app on a phone (Meta moves it to the business account).
- Templates are Meta's: the text a gym edits under WhatsApp › Templates is not what members see until the changed template is
  approved. Custom messages (free text) only reach a member who messaged the gym in the last 24 hours; everything else is a template.
- Meta charges per conversation, at its own rates, to the payment method the gym adds in the pop-up.
