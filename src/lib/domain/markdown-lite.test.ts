import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdownLite, plainText } from "./markdown-lite";
import { MarkdownLite } from "@/components/markdown-lite";

describe("reading Fitron AI's formatting", () => {
  it("splits paragraphs, headings, bullet and numbered lists", () => {
    const b = parseMarkdownLite("## Dues\nTwo members owe money.\n\n- Asha: ₹1,180\n* Ravi: ₹500\n• Meena: ₹200\n\n1. Call them\n2. Send a reminder");
    expect(b.map((x) => x.t)).toEqual(["h", "p", "ul", "ol"]);
    expect(b[0]).toMatchObject({ t: "h", level: 2 });
    expect(plainText(b[0]!.t === "h" ? b[0].c : [])).toBe("Dues");
    expect(b[2]!.t === "ul" && b[2].items.map(plainText)).toEqual(["Asha: ₹1,180", "Ravi: ₹500", "Meena: ₹200"]);
    expect(b[3]).toMatchObject({ t: "ol", start: 1 });
  });

  it("turns **bold**, *italic*, _italic_ and `code` into runs, and leaves stray marks alone", () => {
    expect(parseInline("Total **₹7,080** is *due* _today_ for `INV-1042`")).toEqual([
      { t: "text", v: "Total " },
      { t: "bold", c: [{ t: "text", v: "₹7,080" }] },
      { t: "text", v: " is " },
      { t: "italic", c: [{ t: "text", v: "due" }] },
      { t: "text", v: " " },
      { t: "italic", c: [{ t: "text", v: "today" }] },
      { t: "text", v: " for " },
      { t: "code", v: "INV-1042" },
    ]);
    expect(plainText(parseInline("2*3*4 and snake_case_name and a lone ** mark"))).toBe("2*3*4 and snake_case_name and a lone ** mark");
    expect(parseInline("2*3*4").every((x) => x.t === "text")).toBe(true);
    expect(parseInline("snake_case_name").every((x) => x.t === "text")).toBe(true);
  });

  it("reads a pipe table, dropping the |---| rule and marking the heading row", () => {
    const [t] = parseMarkdownLite("| Month | Revenue |\n|---|---:|\n| Sep | ₹1,20,000 |\n| Oct | ₹95,000 |");
    expect(t).toMatchObject({ t: "table", header: true });
    if (t?.t !== "table") throw new Error("expected a table");
    expect(t.rows.map((r) => r.map(plainText))).toEqual([
      ["Month", "Revenue"],
      ["Sep", "₹1,20,000"],
      ["Oct", "₹95,000"],
    ]);
    const [plain] = parseMarkdownLite("| a | b |\n| c | d |");
    expect(plain).toMatchObject({ t: "table", header: false });
  });

  it("links the app's own paths, opening PDFs and web addresses in a new tab, and ignores slashes in numbers and words", () => {
    const runs = parseInline("See /invoices/ckx1 (PDF: /invoices/ckx1/pdf). Member /members/abc?tab=dues, and https://fitron.in/help.");
    const links = runs.filter((x) => x.t === "link");
    expect(links).toEqual([
      { t: "link", href: "/invoices/ckx1", label: "/invoices/ckx1", app: true, newTab: false },
      { t: "link", href: "/invoices/ckx1/pdf", label: "/invoices/ckx1/pdf", app: true, newTab: true },
      { t: "link", href: "/members/abc?tab=dues", label: "/members/abc?tab=dues", app: true, newTab: false },
      { t: "link", href: "https://fitron.in/help", label: "https://fitron.in/help", app: false, newTab: true },
    ]);
    expect(plainText(runs)).toBe("See /invoices/ckx1 (PDF: /invoices/ckx1/pdf). Member /members/abc?tab=dues, and https://fitron.in/help.");
    for (const s of ["18/20 sessions", "₹500/month", "and/or", "a / b", "GST 9%/9%"]) expect(parseInline(s).every((x) => x.t === "text"), s).toBe(true);
  });

  it("keeps the text intact while a reply is still streaming in", () => {
    for (const partial of ["**Tot", "**Total**\n\n- one\n- tw", "| a |", "| a | b |\n|--"]) expect(plainText(parseMarkdownLite(partial).flatMap((b) => (b.t === "p" || b.t === "h" ? b.c : b.t === "table" ? b.rows.flat(2) : b.items.flat())))).toBeTruthy();
  });

  it("renders as elements, never as raw HTML", () => {
    const html = renderToStaticMarkup(createElement(MarkdownLite, { text: "**Open** /invoices/ckx1 or /invoices/ckx1/pdf, see https://fitron.in <script>alert(1)</script>\n\n| a | b |\n|---|---|\n| 1 | 2 |" }));
    expect(html).toContain("<strong");
    expect(html).toContain('href="/invoices/ckx1">/invoices/ckx1</a>');
    expect(html).not.toContain('href="/script"');
    expect(html).toContain('href="/invoices/ckx1/pdf" target="_blank"');
    expect(html).toContain('href="https://fitron.in" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
