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

A gym gets a licence in Settings › Licence. The owner copies the installation id shown there and sends it to FITRON
support. FITRON sends back a `.fitronlicence` file, which is imported on the same page as a file or pasted as text.

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
(`src/lib/licence/store.ts`). No licence data goes to any server.

## For FITRON

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
