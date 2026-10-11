import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DiskFileStorage } from "./disk-storage";
import { assertValidKey, FileMissingError } from "./file-storage";

describe("disk file storage (Local Edition documents folder)", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "fitron-files-"));
  const s = new DiskFileStorage(root);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("writes, reads, sizes, lists and deletes files under the gym's folder", async () => {
    await s.put("org1/members/m1/a.pdf", Buffer.from("%PDF-1.7 one"), "application/pdf");
    await s.put("org1/gym/logo-x.png", Buffer.from("png"), "image/png");
    await s.put("org2/members/m9/b.pdf", Buffer.from("other gym"), "application/pdf");
    expect(Buffer.from(await s.get("org1/members/m1/a.pdf")).toString()).toBe("%PDF-1.7 one");
    expect((await s.stat("org1/members/m1/a.pdf"))?.size).toBe(12);
    expect((await s.list("org1/")).map((f) => f.key)).toEqual(["org1/gym/logo-x.png", "org1/members/m1/a.pdf"]);
    expect((await s.list("org1/members/")).map((f) => f.key)).toEqual(["org1/members/m1/a.pdf"]);
    await s.delete("org1/members/m1/a.pdf");
    await s.delete("org1/members/m1/a.pdf"); // a second delete is fine
    expect(await s.stat("org1/members/m1/a.pdf")).toBeNull();
  });

  it("says a missing file is missing, rather than failing in some other way", async () => {
    await expect(s.get("org1/members/nobody/x.pdf")).rejects.toBeInstanceOf(FileMissingError);
    expect(await s.list("org-none/")).toEqual([]);
  });

  it("replaces a file whole, leaves no temporary file behind, and ignores one a crash left", async () => {
    await s.put("org1/docs/r.pdf", Buffer.from("first version"), "application/pdf");
    await s.put("org1/docs/r.pdf", Buffer.from("second"), "application/pdf");
    expect(Buffer.from(await s.get("org1/docs/r.pdf")).toString()).toBe("second");
    expect(readdirSync(path.join(root, "org1", "docs"))).toEqual(["r.pdf"]);
    // What a power cut between write and rename leaves: a temporary file the listing must not report.
    writeFileSync(path.join(root, "org1", "docs", ".fitron-tmp-deadbeef"), "half");
    expect((await s.list("org1/docs/")).map((f) => f.key)).toEqual(["org1/docs/r.pdf"]);
  });

  it("refuses keys that climb out of the folder or that Windows cannot name", () => {
    for (const bad of ["../x.pdf", "org1/../../etc/passwd", "/abs.pdf", "org1//x.pdf", "org1\\x.pdf", "org1/CON", "org1/nul.pdf", "org1/x.", "org1/a b.pdf", "", "x".repeat(201)]) {
      expect(() => assertValidKey(bad), bad).toThrow(/Bad storage key/);
    }
    for (const good of ["org1/members/m1/3f2a.pdf", "cmv3asne7/gym/logo-1b2c.png", "o/backups/b1.json"]) expect(() => assertValidKey(good)).not.toThrow();
    expect(() => s.pathOf("../outside")).toThrow();
  });

  it("keeps files beside the program untouched: everything stays under the root", async () => {
    mkdirSync(path.join(root, "org3"), { recursive: true });
    await s.put("org3/x.png", Buffer.from("x"), "image/png");
    expect(existsSync(path.join(root, "org3", "x.png"))).toBe(true);
    expect(s.pathOf("org3/x.png").startsWith(root + path.sep)).toBe(true);
  });
});
