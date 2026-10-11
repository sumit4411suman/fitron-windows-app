import type { TrustedKey } from "./licence";

// FITRON's licence signing keys, public halves only. FITRON makes a key once with `npm run licence:keygen`, keeps the
// private key offline (never in this repository), and adds the public key here before building a release. Keys are
// never removed while licences signed with them are in use; a new key is added beside the old one.
//
// Until FITRON adds its key, this build cannot accept any licence: it runs its 30-day trial, then keeps every record
// readable and exportable but adds nothing new, and Settings › Licence says that this build has no key.

export const FITRON_LICENCE_KEYS: TrustedKey[] = [];
