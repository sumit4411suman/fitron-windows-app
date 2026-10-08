import { describe, expect, it } from "vitest";
import { BACKUP_FORMAT, BACKUP_TABLES, RESTORE_TABLES, ageText, backupFileName, daysSince, decodeRow, encodeRow, parseBackup, sizeText, summarise } from "./backup";

describe("backup rows", () => {
  it("round-trips dates, decimals, bytes, bigints, nulls and JSON", () => {
    const at = new Date("2026-10-04T12:30:15.123Z");
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const decimal = { toFixed: () => "18.00", toString: () => "18" };
    const spec = { name: "T", json: ["payload"], decimal: ["rate"], bytes: ["data"], strip: ["passwordHash"] };
    const enc = encodeRow({ id: "a", at, rate: decimal, data: bytes, big: BigInt(42), nothing: null, payload: { a: [1, { b: null }] }, tags: ["x"], passwordHash: "secret" }, spec);
    expect(enc).toEqual({ id: "a", at: "2026-10-04T12:30:15.123Z", rate: "18", data: { $bytes: Buffer.from(bytes).toString("base64") }, big: "42", nothing: null, payload: { a: [1, { b: null }] }, tags: ["x"] });
    expect(JSON.parse(JSON.stringify(enc))).toEqual(enc);
    const dec = decodeRow(JSON.parse(JSON.stringify(enc)), spec);
    expect(dec.at).toBeInstanceOf(Date);
    expect((dec.at as Date).toISOString()).toBe(at.toISOString());
    expect(dec.rate).toBe("18");
    expect(dec.data).toBeInstanceOf(Uint8Array);
    expect([...(dec.data as Uint8Array)]).toEqual([...bytes]);
    expect(dec.big).toBe("42");
    expect(dec.nothing).toBeNull();
    expect(dec.payload).toEqual({ a: [1, { b: null }] });
    expect(dec.tags).toEqual(["x"]);
    expect("passwordHash" in dec).toBe(false);
  });

  it("leaves ordinary strings and ISO-looking JSON values alone", () => {
    const dec = decodeRow({ note: "2026-10-04", when: "2026-10-04T00:00:00Z", v: { at: "2026-10-04T12:30:15.123Z" } }, { name: "T", json: ["v"] });
    expect(dec.note).toBe("2026-10-04");
    expect(dec.when).toBe("2026-10-04T00:00:00Z");
    expect(dec.v).toEqual({ at: "2026-10-04T12:30:15.123Z" });
  });
});

describe("parseBackup", () => {
  const good = { app: "fitron", format: 1, exportedAt: "2026-10-04T00:00:00.000Z", org: { id: "org1" }, tables: { Member: [{ id: "m1" }] }, counts: { members: 1 } };
  it("returns null for anything that is not a Fitron backup", () => {
    expect(parseBackup("hello")).toBeNull();
    expect(parseBackup("[1,2]")).toBeNull();
    expect(parseBackup(JSON.stringify({ ...good, app: "other" }))).toBeNull();
    expect(parseBackup(JSON.stringify({ ...good, format: "1" }))).toBeNull();
    expect(parseBackup(JSON.stringify({ ...good, format: 1.5 }))).toBeNull();
    expect(parseBackup(JSON.stringify({ ...good, org: {} }))).toBeNull();
    expect(parseBackup(JSON.stringify({ ...good, tables: {} }))).toBeNull();
    expect(parseBackup(JSON.stringify({ ...good, tables: { Member: [{ name: "no id" }] } }))).toBeNull();
  });
  it("returns the parsed file, and reports a newer format instead of throwing", () => {
    expect(parseBackup(JSON.stringify(good))).toMatchObject({ app: "fitron", format: 1, org: { id: "org1" }, counts: { members: 1 } });
    expect(parseBackup(JSON.stringify({ ...good, format: BACKUP_FORMAT + 5 }))?.format).toBe(BACKUP_FORMAT + 5);
    expect(parseBackup(JSON.stringify({ app: "fitron", format: 1, org: { id: "o" }, tables: { Member: [] } }))).toMatchObject({ exportedAt: "", counts: {} });
  });
});

describe("BACKUP_TABLES", () => {
  it("lists every table after the tables it references", () => {
    const seen = new Set<string>();
    for (const t of BACKUP_TABLES) {
      for (const parent of Object.values(t.refs ?? {})) expect(seen.has(parent), `${t.name} references ${parent}, which must come earlier`).toBe(true);
      seen.add(t.name);
    }
    expect(new Set(BACKUP_TABLES.map((t) => t.name)).size).toBe(BACKUP_TABLES.length);
    expect(RESTORE_TABLES.map((t) => t.name)).not.toContain("AuditLog");
    expect(BACKUP_TABLES.map((t) => t.name)).toContain("AuditLog");
  });
});

describe("backup texts", () => {
  it("summarises counts, ages, sizes and file names", () => {
    expect(summarise({ members: 60, invoices: 67, payments: 58 })).toBe("60 members · 67 invoices · 58 payments");
    expect(summarise({ members: 1200 })).toBe("1,200 members · 0 invoices · 0 payments");
    const now = new Date("2026-10-04T10:00:00.000Z");
    expect(ageText(new Date("2026-10-04T01:00:00.000Z"), now)).toBe("Today");
    expect(ageText(new Date("2026-10-03T12:00:00.000Z"), now)).toBe("Yesterday");
    expect(ageText(new Date("2026-09-29T12:00:00.000Z"), now)).toBe("5 days ago");
    expect(daysSince(new Date("2026-09-29T12:00:00.000Z"), now)).toBe(5);
    expect(sizeText(0)).toBe("0 KB");
    expect(sizeText(900)).toBe("1 KB");
    expect(sizeText(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(backupFileName("Power Haus Gym (demo)", new Date("2026-10-04T12:30:00.000Z"))).toBe("fitron-backup-power-haus-gym-demo-2026-10-04-1800.json");
    expect(backupFileName("   ", new Date("2026-10-04T12:30:00.000Z"))).toBe("fitron-backup-gym-2026-10-04-1800.json");
  });
});
