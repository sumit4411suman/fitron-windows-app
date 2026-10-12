// Release checks of FITRON for Windows' Authenticode signatures (Phase 25, docs/local-windows/RELEASE.md). What Windows
// reports for each file (PowerShell's Get-AuthenticodeSignature), and whether a release may ship with it: every file
// FITRON installs and runs signed, valid, by FITRON's own certificate, and timestamped (a timestamp keeps the signature
// valid after the certificate expires). Never weakened to let an unsigned build through: an unsigned build is reported
// as such, and a release build that requires signing fails.

export type FileSignature = {
  file: string;
  /** Valid, NotSigned, HashMismatch, NotTrusted, UnknownError… as Windows reports it. */
  status: string;
  /** The signing certificate's subject, e.g. "CN=FITRON Technologies Private Limited, O=…, C=IN". */
  signer: string | null;
  /** The timestamping authority's subject, or null when the signature has no timestamp. */
  timestamper: string | null;
};

export type SignatureVerdict = { ok: boolean; lines: string[] };

/**
 * A file FITRON ships unchanged from its maker may keep the maker's own signature: the bundled Node.js runtime is
 * signed by the OpenJS Foundation (re-signed by FITRON when the build signs it too). Valid and timestamped either way.
 */
export const VENDOR_SIGNED: { file: RegExp; publishers: string[] }[] = [{ file: /fitron-node[^\\/]*\.exe$/i, publishers: ["OpenJS Foundation"] }];

/** The subject's common name and organisation, as a person reads them ("FITRON Technologies Private Limited"). */
export function publisherOf(subject: string | null): string | null {
  if (!subject) return null;
  const part = (k: string) => new RegExp(`(?:^|,\\s*)${k}="?([^,"]+)"?`).exec(subject)?.[1]?.trim();
  return part("O") ?? part("CN") ?? subject;
}

/**
 * Judges the files of a build. `require`: a release, which must be signed; otherwise the report only says what Windows
 * would show (an unsigned development build is expected, and named as such).
 */
export function judgeSignatures(files: FileSignature[], o: { require: boolean; publisher: string; vendors?: typeof VENDOR_SIGNED }): SignatureVerdict {
  const lines: string[] = [];
  let ok = files.length > 0;
  if (!files.length) lines.push("✗ no files to check");
  for (const f of files) {
    const who = publisherOf(f.signer);
    const problems: string[] = [];
    const allowed = [o.publisher, ...(o.vendors ?? VENDOR_SIGNED).filter((v) => v.file.test(f.file)).flatMap((v) => v.publishers)];
    if (!f.status) {
      // Windows said nothing about the file: the check itself failed, so the report would be meaningless.
      problems.push("Windows reported no signature status (the check did not run)");
      ok = false;
    } else if (f.status !== "Valid") problems.push(f.status === "NotSigned" ? "not signed" : `signature ${f.status}`);
    else {
      if (!who || !allowed.some((p) => who.toLowerCase().includes(p.toLowerCase()))) problems.push(`signed by ${who ?? "an unknown publisher"}, not ${allowed.join(" or ")}`);
      if (!f.timestamper) problems.push("no timestamp (the signature would stop being valid when the certificate expires)");
    }
    if (!problems.length) lines.push(`✓ ${f.file}: signed by ${who}, timestamped`);
    else {
      lines.push(`${o.require || !f.status ? "✗" : "-"} ${f.file}: ${problems.join("; ")}`);
      if (o.require) ok = false;
    }
  }
  if (!o.require && files.some((f) => f.status === "NotSigned")) lines.push("This build is not code-signed: Windows shows \"Unknown publisher\" and SmartScreen warns before the first install. Updates still need FITRON's update key (docs/local-windows/RELEASE.md).");
  return { ok, lines };
}
