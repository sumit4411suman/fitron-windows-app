import * as z from "zod";

// Zod 4 compiles object schemas with `new Function` when it can, and finds out whether it can by trying one. Under the
// Content-Security-Policy (src/lib/csp.ts) that try is a reported violation on every page that loads a form's schema,
// which would bury real ones. Switching the compiler off skips the try; parsing is the same, just not pre-compiled, which
// is not measurable at our volumes. Import this wherever a schema is defined.
z.config({ jitless: true });
