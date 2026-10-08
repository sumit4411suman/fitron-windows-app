import { deflateRawSync } from "node:zlib";

// A small writer for real Excel files (.xlsx), so a report opens in Excel, Google Sheets and LibreOffice with numbers as
// numbers, dates as dates, a bold frozen header row and sensible column widths. No dependency: an .xlsx is a zip of a few
// XML files, and this writes exactly the parts a one-sheet workbook needs.
//
// Text is always stored as text (an inline string), never as a formula, so a member named "=HYPERLINK(...)" is shown, not run.

export type XCell = string | number | null | undefined;
export type XKind = "text" | "money" | "int" | "pct" | "date";
export type XColumn = { label: string; kind?: XKind };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ── zip ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The date and time as a zip header stores them (two 16-bit fields). */
function dosStamp(d: Date) {
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const date = ((Math.max(1980, d.getUTCFullYear()) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

/** A zip file holding `files` (name → text), each compressed with deflate. */
export function zip(files: [name: string, text: string][], now = new Date()): Uint8Array {
  const { time, date } = dosStamp(now);
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(text);
    const data = deflateRawSync(raw);
    const crc = crc32(raw);

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true); // version needed
    lh.setUint16(6, 0x0800, true); // names are UTF-8
    lh.setUint16(8, 8, true); // deflate
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, raw.length, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    locals.push(new Uint8Array(lh.buffer), nameBytes, data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true); // version made by
    ch.setUint16(6, 20, true); // version needed
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 8, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, raw.length, true);
    ch.setUint16(28, nameBytes.length, true);
    // extra, comment, disk, internal and external attributes stay 0
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ── workbook parts ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Text safe to put in XML: the five markup characters escaped, and the control characters XML cannot hold removed. */
export const xml = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** "A".."Z", "AA".. for a zero-based column number. */
export function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Days since 1899-12-30, the number Excel stores for a date (ISO text "2026-10-01" in, a whole number out). */
export function excelDate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

// Cell formats (styles.xml cellXfs, by position). 0 plain; 1 header; 2 rupees; 3 whole number with thousands; 4 percent;
// 5 date; 6-9 the same as 2-5 in bold on a rule, for the totals row; 10 bold text on a rule.
const S = { head: 1, money: 2, int: 3, pct: 4, date: 5, totalOffset: 4, totalText: 10 } as const;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0&quot;%&quot;"/><numFmt numFmtId="166" formatCode="dd\\-mmm\\-yyyy"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border><border><left/><right/><top style="thin"><color auto="1"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="3" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="166" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

/** A sheet name Excel accepts: at most 31 characters, none of [ ] : * ? / \ , not empty. */
export const sheetName = (s: string) => s.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet1";

const MAX_TEXT = 32_000; // Excel holds 32,767 characters in a cell

function cellXml(ref: string, v: XCell, kind: XKind | undefined, style: number): string {
  if (v == null || v === "") return style ? `<c r="${ref}" s="${style}"/>` : "";
  if (typeof v === "number" && Number.isFinite(v)) {
    const n = kind === "money" ? v / 100 : v;
    const s = style || (kind === "money" ? S.money : kind === "pct" ? S.pct : kind === "int" && Number.isInteger(n) ? S.int : 0);
    return `<c r="${ref}"${s ? ` s="${s}"` : ""}><v>${n}</v></c>`;
  }
  const text = String(v);
  if (ISO_DATE.test(text) && kind !== "text") return `<c r="${ref}" s="${style || S.date}"><v>${excelDate(text)}</v></c>`;
  const t = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${xml(t)}</t></is></c>`;
}

export type Sheet = {
  /** The sheet's tab name. */
  name: string;
  columns: XColumn[];
  rows: XCell[][];
  /** A last row shown bold on a rule: one cell per column. */
  totals?: XCell[];
};

/** A one-sheet workbook as the bytes of an .xlsx file. */
export function buildXlsx(sheet: Sheet, { title = sheet.name, now = new Date() }: { title?: string; now?: Date } = {}): Uint8Array {
  const cols = sheet.columns;
  const rowsOut: string[] = [];
  const header = cols.map((c, i) => cellXml(`${colName(i)}1`, c.label, "text", S.head)).join("");
  rowsOut.push(`<row r="1">${header}</row>`);
  sheet.rows.forEach((row, r) => {
    const cells = cols.map((c, i) => cellXml(`${colName(i)}${r + 2}`, row[i], c.kind, 0)).join("");
    rowsOut.push(`<row r="${r + 2}">${cells}</row>`);
  });
  if (sheet.totals) {
    const r = sheet.rows.length + 2;
    const cells = cols
      .map((c, i) => {
        // A total is bold on a rule; its number format follows the column only when the value is a number (or a date).
        const v = sheet.totals![i];
        const base = typeof v === "number" ? (c.kind === "money" ? S.money : c.kind === "pct" ? S.pct : c.kind === "int" ? S.int : 0) : typeof v === "string" && ISO_DATE.test(v) && c.kind !== "text" ? S.date : 0;
        return cellXml(`${colName(i)}${r}`, v, c.kind, base ? base + S.totalOffset : S.totalText);
      })
      .join("");
    rowsOut.push(`<row r="${r}">${cells}</row>`);
  }

  // Column width in characters: the longest of the heading and the first 200 values, kept between 8 and 50.
  const widths = cols.map((c, i) => {
    let w = c.label.length + 2;
    for (const row of sheet.rows.slice(0, 200)) {
      const v = row[i];
      const len = v == null ? 0 : typeof v === "number" ? (c.kind === "money" ? (v / 100).toFixed(2).length + 2 : String(v).length) : ISO_DATE.test(v) ? 11 : v.length;
      if (len + 2 > w) w = len + 2;
    }
    return Math.min(50, Math.max(8, w));
  });
  const colsXml = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;
  const last = `${colName(Math.max(0, cols.length - 1))}${sheet.rows.length + 1 + (sheet.totals ? 1 : 0)}`;

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${last}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>${colsXml}<sheetData>${rowsOut.join("")}</sheetData>` +
    `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${xml(sheetName(sheet.name))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const core =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${xml(title)}</dc:title><dc:creator>FITRON</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now.toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`;

  return zip(
    [
      ["[Content_Types].xml", CONTENT_TYPES],
      ["_rels/.rels", ROOT_RELS],
      ["docProps/core.xml", core],
      ["xl/workbook.xml", workbook],
      ["xl/_rels/workbook.xml.rels", WORKBOOK_RELS],
      ["xl/styles.xml", STYLES],
      ["xl/worksheets/sheet1.xml", sheetXml],
    ],
    now,
  );
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
