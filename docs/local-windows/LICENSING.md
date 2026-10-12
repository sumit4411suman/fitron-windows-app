# FITRON Local Windows Edition: licensing (Phase 13)

FITRON for Windows is licensed with a signed licence file. It is checked on the gym's computer with FITRON's public
key, so it works with no internet at all, and nothing about the gym leaves the computer to check it.

## For the gym

| When | What FITRON does |
| --- | --- |
| Days 1 to 30 after installing | Free trial: everything works. A banner appears in the last 7 days. |
| A licence is imported | Licensed: everything works, with the licence's number of active branches. A banner appears in its last 30 days. |
| The licence's end date has passed | Grace: everything keeps working for the licence's grace days (15 by default) while the renewal arrives. |
| After the trial, or after the grace days | Nothing new can be added (members, sales, invoices, imports). Every record stays readable: dues can be collected, reports run, data exported and backed up. Importing a licence brings everything back at once. |

A gym buys or renews in Settings › Licence › **Buy or renew on fitron.in**:

1. The button opens `fitron.in/windows/buy` in the computer's browser, with this computer's installation id and a
   one-time claim FITRON makes for this purchase (kept in the data folder as `licence-purchase.json`).
2. The owner picks a plan (the same Starter, Professional and Enterprise as fitron.in, at the same prices, GST included,
   monthly or yearly), types the gym's name for the licence and an email for the receipt (a phone and GSTIN if they
   like), and pays with Razorpay into FITRON's account.
3. fitron.in signs a licence for that one computer, until the end of the period paid for. A renewal starts the day after
   the current licence ends.
4. FITRON collects it with the claim and installs it: every few seconds while Settings › Licence is open, and every hour
   otherwise, for up to 30 days. **Check now** asks at once. Nothing needs copying.

Only the installation id and the claim go from the computer to fitron.in (`collectBoughtLicence()` in
`src/lib/integrations/license`), never a member, payment or book. Once installed, the licence is checked on the
computer as before, with no internet.

The plan sets what it does on fitron.in too: Starter allows 100 active members and Professional 300, each one branch;
Enterprise has no member cap and 3 branches. During the trial everything is open.

A licence can still be issued by hand (below): FITRON support sends a `.fitronlicence` file, imported on the same page
as a file or pasted as text.

## The licence file

One line: `FITRON-LICENCE-1.<payload>.<signature>`. The payload is JSON (base64url) with:

- licence id
- the key that signed it
- licensee
- plan
- edition `local`
- active branches
- optional installation id: the licence then works only on that computer
- issued and expiry dates
- grace days

The signature is FITRON's Ed25519 signature over the payload. A changed character, a different key or a licence made
for another computer is refused, with the reason on screen. `src/lib/licence/licence.ts` holds the format, the check and
the status rules.

The licence and the latest date the app has seen are kept in the data folder (`licence.fitronlicence`,
`licence-state.json`). Winding the computer's clock back does not give back days of a licence or trial already used
(`src/lib/licence/store.ts`). Checking a licence sends nothing anywhere.

## For FITRON

### Selling licences on fitron.in

fitron.in signs the licences it sells (`src/lib/services/windows-licence.ts`), so it holds a signing key of its own,
separate from the offline key below: a key on a server is the one most at risk, and keeping them apart means the
offline key never has to be replaced if the server's is.

1. Make the key on FITRON's own computer, from this repository:
   ```
   npm run licence:keygen -- --id fitron-online-2026 --out /secure/place/fitron-licence-online-2026.pem
   ```
2. Paste the printed public line into `FITRON_LICENCE_KEYS` in `src/lib/licence/keys.ts` (with the offline key, if
   there is one) and release FITRON for Windows with it.
3. On fitron.in's server, set `FITRON_LICENCE_SIGNING_KEY` to the private key (the PEM's text, or base64 of it) and
   `FITRON_LICENCE_SIGNING_KEY_ID` to `fitron-online-2026`. FITRON's Razorpay keys and webhook (deploy/README.md) are
   the same ones plan payments use.

Each sale is a `WindowsLicenceOrder` row on fitron.in: the plan, the price split into taxable value and GST, FITRON's
invoice number (the same series as plan payments), Razorpay's order and payment, the buyer's details and the licence.
Rows are never deleted. A payment made while the signing key is missing is kept as paid and its licence is signed the
first time the computer asks after the key is set; one whose captured amount differs from the order is held for a person
to look at (`windows_licence.amount_mismatch` in the log).

### Issuing a licence by hand

Once, before the first release:

```
npm run licence:keygen -- --id fitron-2026 --out /secure/place/fitron-licence-2026.pem
```

- Keep the private key offline and backed up. Anyone holding it can issue licences, and it never goes into this
  repository.
- Paste the printed line into `FITRON_LICENCE_KEYS` in `src/lib/licence/keys.ts`.
- A build without a key cannot accept any licence, and Settings › Licence says so.
- To replace a key, add the new one beside the old. Never remove a key while licences signed with it are in use.

For each gym:

```
npm run licence:issue -- --key /secure/place/fitron-licence-2026.pem --key-id fitron-2026 --licence-id FIT-2026-00042 \
  --licensee "Iron Gym, Pune" --plan professional --branches 1 --expires 2027-10-31 --installation <installation id> \
  --out iron-gym.fitronlicence
```

The tool checks the licence the way the app will before printing it. `--grace` changes the grace days (default 15).

## What it cannot do

A desktop program runs on a computer its owner controls. The signature stops a licence being made or edited without
FITRON's key, and the clock guard stops the easy rewind. Neither stops someone who changes the program itself; that
needs the code signing and tamper checks of Phases 19 and 25.

## Tests

| Test | What it proves |
| --- | --- |
| `src/lib/licence/licence.test.ts` | signed licences are accepted, changed or foreign ones refused; trial, active, grace and ended days; licences for another computer; import; a damaged file; the clock guard |
| `src/lib/services/licence.db.test.ts` | after the trial nothing new is added but dues can be collected; branches come from the licence |
| `e2e/local/startup.spec.ts` | Settings › Licence shows the trial and the installation id, and refuses a false licence |
| `src/lib/services/windows-licence.db.test.ts` | fitron.in sells at its own prices, signs for one computer and claim, renews from the end of the current licence, keeps a payment made without the key, refuses a wrong amount |
| `src/lib/licence/purchase.test.ts` | the buy link, collecting and installing once paid, refusing another computer's licence, waiting while offline |
| `src/lib/services/licence-plan.db.test.ts` | a bought licence's plan sets the member cap, features and branches |
