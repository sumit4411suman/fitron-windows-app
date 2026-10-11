# FITRON Local Windows Edition: printing (Phase 17)

FITRON prints its documents as PDFs made for the paper they go on, not as a printout of the screen. A PDF has its own
page size, so Windows sends it to the printer at exactly that size, through the printer's own driver: an office
printer for A4 and A5, a thermal receipt printer for 80 mm and 58 mm rolls. The same documents are used by the Cloud
Edition and by WhatsApp (the invoice sent after a renewal).

| Document | Papers | Default | Where |
| --- | --- | --- | --- |
| GST invoice | A4, A5, 80 mm, 58 mm | A4 | Invoice › Print invoice |
| Payment receipt | 80 mm, 58 mm, A5, A4 | 80 mm | Invoice › Print receipt (the latest payment), each payment on the invoice, Payments › Receipt, and right after "Record payment" |

The paper chosen for each kind of document is remembered on this computer. "PDF" saves the document instead of
printing it. "Print page" is still there for a printout of the screen.

## What each document says

**GST invoice** (`src/lib/pdf/invoice.ts`): the gym (logo or monogram, address, phone, email, GSTIN; a branch's own
GSTIN wins), "TAX INVOICE" when GST is charged, invoice number, dates and status, the member, the membership and its
dates, each item with quantity, rate, discount and GST rate (long descriptions wrap), subtotal, discount, CGST and SGST
(each half, the odd paisa to SGST) or IGST, total, paid, balance, the total in words, the payments (reversed ones
marked), SAC and the signatory line. On a roll the same content is stacked in one column, in black only.

**Payment receipt** (`src/lib/pdf/receipt.ts`): the receipt number (the payment's PAY code), date, who paid, the amount
in figures and in words (with paise), the payment mode and reference, what it was for (the membership and its dates, or
the items), the invoice it pays, the invoice total, what had been paid by then and what was still due, and who received
it. This is the receipt handed to the member: the "member receipt" and the "payment receipt" are one document.
"Paid to date" counts the invoice's payments in the order they were entered, so a receipt printed again later still
says what was due when it was given. A payment that was reversed prints as **RECEIPT · CANCELLED** with the date and
the reason, never as a valid receipt, and counts for nothing in later receipts.

Amounts in words use Indian grouping (lakh, crore) and paise: "Rupees Two Thousand and Fifty Paise only"
(`src/lib/domain/words.ts`).

## Papers

| Paper | Size | Margins | Notes |
| --- | --- | --- | --- |
| A4 | 210 × 297 mm | 17 mm | Several pages when needed; the item headings repeat on each |
| A5 | 148 × 210 mm | 10.5 mm | A4's layout at 80% type size |
| 80 mm | 80 mm wide, as long as the receipt | 4 mm each side (72 mm printed) | Black only, no logo |
| 58 mm | 58 mm wide, as long as the receipt | 5 mm each side (48 mm printed) | Black only, no logo |

A roll is cut where the document ends: the PDF's page is exactly as long as its content.

## Setting up a thermal printer on Windows

1. Install the printer's Windows driver (from its maker; most 80 mm and 58 mm ESC/POS printers come with one).
2. In the driver's printing preferences pick the roll width (80 mm or 58 mm) and the longest page length it offers,
   and turn on cutting at the end of the document if the printer has a cutter.
3. In FITRON choose 80 mm or 58 mm for receipts once; it is remembered.
4. In the print window choose the thermal printer, **Actual size** (not "fit"), no margins.

FITRON does not send raw printer commands, so it works with any printer Windows can print to, and never needs a
printer port, a driver of its own or administrator rights.

## Tests

| Test | What it proves |
| --- | --- |
| `src/lib/pdf/documents.test.ts` (14) | On A4, A5, 80 mm and 58 mm: the page is the paper's size (a roll as long as its content), every piece of text sits inside the printable margins, the invoice says everything it must (GSTIN, CGST and SGST, totals, words, payments, SAC), a long description wraps whole, a long invoice runs onto more pages with its headings repeated, a receipt says everything it must, a reversed payment prints as cancelled |
| `src/lib/domain/words.test.ts` | amounts in words, Indian grouping, paise |
| `src/lib/services/receipt.db.test.ts` | from the real books (PostgreSQL and SQLite): each part payment's receipt with what was due after it; a reversed payment cancelled and left out of later totals; the invoice on every paper; nothing for another gym |
| `e2e/local/printing.spec.ts` | on both editions, as at the desk: Print invoice on each paper, the paper remembered after a reload, Save PDF, Print receipt after the sale, the receipt offered right after Record payment, receipts in the Payments list, an unknown receipt is not found |
