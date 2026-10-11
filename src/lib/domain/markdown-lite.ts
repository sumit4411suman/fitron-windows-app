// A small reader for the formatting Fitron AI's replies use: paragraphs, **bold**, *italic*, `code`, bullet and numbered
// lists, # headings, simple | pipe | tables, and links. It knows the app's own paths (/invoices/<id>, /members/<id>,
// /invoices/<id>/pdf …) and web addresses so the screen can make them clickable. Pure: text in, a block tree out; the
// React side (src/components/markdown-lite.tsx) only draws the tree, so nothing here is ever treated as HTML.

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold"; c: Inline[] }
  | { t: "italic"; c: Inline[] }
  | { t: "code"; v: string }
  /** `app`: a path inside Fitron. `newTab`: open it in a new tab (web addresses, PDFs). */
  | { t: "link"; href: string; label: string; app: boolean; newTab: boolean };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] }
  /** `header`: the first row is a heading row (it was followed by a |---| line). */
  | { t: "table"; header: boolean; rows: Inline[][][] };

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s{0,3}[-*•]\s+(.*)$/;
const NUMBERED = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Text → blocks. Lines that don't start a list, heading or table join the paragraph before them. */
export function parseMarkdownLite(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join("\n")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = line.match(HEADING);
    if (h) {
      flush();
      blocks.push({ t: "h", level: h[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, c: parseInline(h[2]!) });
      continue;
    }
    const b = line.match(BULLET);
    if (b) {
      flush();
      const last = blocks.at(-1);
      if (last?.t === "ul") last.items.push(parseInline(b[1]!));
      else blocks.push({ t: "ul", items: [parseInline(b[1]!)] });
      continue;
    }
    const n = line.match(NUMBERED);
    if (n) {
      flush();
      const last = blocks.at(-1);
      if (last?.t === "ol") last.items.push(parseInline(n[2]!));
      else blocks.push({ t: "ol", start: Number(n[1]), items: [parseInline(n[2]!)] });
      continue;
    }
    if (TABLE_ROW.test(line)) {
      flush();
      if (TABLE_RULE.test(line)) continue;
      const cells = splitRow(line).map(parseInline);
      const last = blocks.at(-1);
      if (last?.t === "table") last.rows.push(cells);
      else blocks.push({ t: "table", header: TABLE_RULE.test(lines[i + 1] ?? ""), rows: [cells] });
      continue;
    }
    if (TABLE_RULE.test(line)) {
      // A rule under a plain line: treat the line as text; the rule itself draws nothing.
      continue;
    }
    // A line inside a list item that is indented continues that item.
    const last = blocks.at(-1);
    if (!para.length && (last?.t === "ul" || last?.t === "ol") && /^\s{2,}\S/.test(line)) {
      last.items[last.items.length - 1]!.push({ t: "text", v: "\n" }, ...parseInline(line.trim()));
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

/** The cells of a | a | b | row (a \| inside a cell is a literal bar). */
function splitRow(line: string): string[] {
  const cells = line
    .trim()
    .replace(/\\\|/g, "\u0000")
    .split("|")
    .map((c) => c.replace(/\u0000/g, "|").trim());
  if (cells.length && cells[0] === "") cells.shift();
  if (cells.length && cells.at(-1) === "") cells.pop();
  return cells;
}

/** A web address, or a path into the app: starts with / after a space or bracket, then a word, so 18/20, and/or and ₹500/month are left alone. */
const LINK = /(https?:\/\/[^\s<>()]+)|(?<![\w/₹.<-])(\/[a-z][\w-]*(?:\/[\w.-]+)*(?:\?[\w.=&-]*)?)/g;
const TRAILING = /[.,;:!?)\]'"»]+$/;

/** Inline text → runs of text, bold, italic, code and links. Unmatched markers stay as plain text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let plain = "";
  const text = () => {
    if (plain) out.push(...linkify(plain));
    plain = "";
  };
  // Where `open` closes, or -1: it must wrap something, not come after a space ("* a *"), and an _ must not run into a
  // word (snake_case_name).
  const closing = (open: string, from: number) => {
    const j = src.indexOf(open, from);
    if (j <= from) return -1;
    if (/\s/.test(src[j - 1]!)) return -1;
    if (open === "_" && /\w/.test(src[j + 1] ?? "")) return -1;
    return j;
  };
  // An emphasis marker opens only at the start or after a non-word character (so 2*3*4 and a_b_c stay text).
  const opens = (at: number) => at === 0 || !/[\w₹]/.test(src[at - 1]!);
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "`") {
      const j = src.indexOf("`", i + 1);
      if (j > i + 1) {
        text();
        out.push({ t: "code", v: src.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    }
    if (src.startsWith("**", i) && /\S/.test(src[i + 2] ?? "")) {
      const j = closing("**", i + 2);
      if (j > 0) {
        text();
        out.push({ t: "bold", c: parseInline(src.slice(i + 2, j)) });
        i = j + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && /\S/.test(src[i + 1] ?? "") && src[i + 1] !== ch && opens(i)) {
      const j = closing(ch, i + 1);
      if (j > 0) {
        text();
        out.push({ t: "italic", c: parseInline(src.slice(i + 1, j)) });
        i = j + 1;
        continue;
      }
    }
    plain += ch;
    i++;
  }
  text();
  return out;
}

/** Plain text with its web addresses and app paths picked out as links. */
function linkify(s: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(LINK)) {
    let raw = m[0];
    const tail = raw.match(TRAILING)?.[0] ?? "";
    raw = raw.slice(0, raw.length - tail.length);
    if (!raw || (m[2] && raw === "/")) continue;
    if (m.index > last) out.push({ t: "text", v: s.slice(last, m.index) });
    const app = !!m[2];
    out.push({ t: "link", href: raw, label: raw, app, newTab: !app || /\/pdf(\?|$)/.test(raw) });
    last = m.index + raw.length;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out;
}

/** The plain words of a tree (for titles, tests and search). */
export function plainText(c: Inline[]): string {
  return c.map((x) => (x.t === "text" ? x.v : x.t === "code" ? x.v : x.t === "link" ? x.label : plainText(x.c))).join("");
}
