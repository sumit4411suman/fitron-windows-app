// Amounts in words, as Indian invoices and receipts print them: Indian grouping (lakh, crore) and paise.

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const two = (x: number) => (x < 20 ? ONES[x]! : TENS[Math.floor(x / 10)]! + (x % 10 ? " " + ONES[x % 10] : ""));
const three = (x: number) => (x >= 100 ? ONES[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " : "") : "") + (x % 100 ? two(x % 100) : "");

/** A whole number in words with Indian grouping: 1,25,000 is "One Lakh Twenty Five Thousand". */
export function numberInWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Not a whole number of rupees: ${n}`);
  if (n === 0) return "Zero";
  const out: string[] = [];
  const crore = Math.floor(n / 1e7);
  if (crore) out.push(numberInWords(crore) + " Crore");
  const lakh = Math.floor((n % 1e7) / 1e5);
  const thousand = Math.floor((n % 1e5) / 1e3);
  const rest = n % 1e3;
  if (lakh) out.push(two(lakh) + " Lakh");
  if (thousand) out.push(two(thousand) + " Thousand");
  if (rest) out.push(three(rest));
  return out.join(" ");
}

/** An amount in paise, in words: 200050 is "Rupees Two Thousand and Fifty Paise only". */
export function amountInWords(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new RangeError(`Not an amount in paise: ${paise}`);
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  if (!rupees && !p) return "Zero rupees only";
  if (!rupees) return `${two(p)} Paise only`;
  return `Rupees ${numberInWords(rupees)}${p ? ` and ${two(p)} Paise` : ""} only`;
}
