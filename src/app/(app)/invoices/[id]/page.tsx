import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { getInvoice } from "@/lib/services/billing";
import { getGymProfile } from "@/lib/services/settings";
import { getTax } from "@/lib/services/tax";
import { todayIso } from "@/lib/services/time";
import { Badge, Card, LinkButton, Notice, ScrollRegion } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { gymLogoUrl } from "@/components/gym-logo";
import { FilePdfIcon } from "@phosphor-icons/react/dist/ssr";
import { fmtDate, formatInr, formatRupees, initials } from "@/lib/format";
import { CancelInvoice, CollectForm, ReversePayment } from "./invoice-forms";

const cx2 = (...c: (string | false)[]) => c.filter(Boolean).join(" ");
/** "Rupees Two Thousand only", Indian grouping, as the prototype prints it. */
function inWords(n: number) {
  n = Math.round(n);
  if (!n) return "Zero rupees only";
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number) => (x < 20 ? a[x]! : b[Math.floor(x / 10)]! + (x % 10 ? " " + a[x % 10] : ""));
  const three = (x: number) => (x >= 100 ? a[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " : "") : "") + (x % 100 ? two(x % 100) : "");
  const out: string[] = [];
  const cr = Math.floor(n / 1e7), lk = Math.floor((n % 1e7) / 1e5), th = Math.floor((n % 1e5) / 1e3), rest = n % 1e3;
  if (cr) out.push(three(cr) + " Crore");
  if (lk) out.push(two(lk) + " Lakh");
  if (th) out.push(two(th) + " Thousand");
  if (rest) out.push(three(rest));
  return "Rupees " + out.join(" ") + " only";
}

const LBL = "mb-1.5 text-[10.5px] font-semibold tracking-[0.14em] text-[#605d5d] uppercase";
const TH2 = "pb-2.5 text-[10.5px] font-semibold tracking-[0.14em] text-[#605d5d] uppercase";
const money = formatRupees;


export const metadata = { title: "Invoice · Fitron" };

export default async function InvoicePage({ params, searchParams }: PageProps<"/invoices/[id]">) {
  const u = await requirePermission("invoices.view");
  const { id } = await params;
  const { created } = await searchParams;
  const inv = await getInvoice(u, id);
  if (!inv) notFound();
  const [profile, tax] = await Promise.all([getGymProfile(u.orgId), getTax(u.orgId)]);
  // What the PDF prints as "From": a branch's own GSTIN wins over the gym-level one.
  const cancelled = inv.status === "CANCELLED";
  const half = inv.gstType === "CGST+SGST";
  const gstin = inv.branch.gstin || tax.gstin;
  const rate = Number(inv.gstRate ?? 0);
  const paid = inv.balance <= 0 && !cancelled;
  const statusBg = cancelled ? "#aa0b56" : paid ? "#146c43" : inv.paid > 0 ? "#8a6612" : "#aa0b56";
  const statusLabel = cancelled ? "CANCELLED" : paid ? "PAID" : inv.paid > 0 ? "PART PAID" : "UNPAID";
  const logo = gymLogoUrl(profile.logoKey);
  const okPays = inv.payments;
  const totals: [string, string, boolean?, string?][] = [
    ["Subtotal", money(inv.subtotal)],
    ["Discount", `− ${money(inv.discount)}`],
    ...((inv.tax > 0
      ? half
        ? [[`CGST ${rate / 2}%`, money(Math.floor(inv.tax / 2))], [`SGST ${rate / 2}%`, money(inv.tax - Math.floor(inv.tax / 2))]]
        : [[`IGST ${rate}%`, money(inv.tax)]]
      : [["Tax", money(0)]]) as [string, string][]),
    ["Grand total", money(inv.total), true, "18px"],
    ["Amount paid", money(inv.paid)],
    ["Balance due", money(inv.balance), true],
  ];

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-3">
      {created && <Notice tone="ok">Invoice created.</Notice>}
      <div className="flex flex-wrap justify-end gap-2 rounded-lg bg-bg p-2.5 print:hidden" data-testid="invoice-from">
        <LinkButton href={`/invoices/${inv.id}/pdf`} prefetch={false} target="_blank">
          <FilePdfIcon size={16} weight="duotone" />
          Download PDF
        </LinkButton>
        <PrintButton label="Print" />
        {!cancelled && inv.balance > 0 && u.can("payments.collect") && (
          <LinkButton href="#collect" variant="primary">
            Collect balance
          </LinkButton>
        )}
        {u.can("members.view") && <LinkButton href={`/members/${inv.memberId}`}>Member</LinkButton>}
      </div>
      <div id="ph-bill" className="flex flex-col overflow-hidden rounded-lg bg-white text-[#201e1d] shadow-lg">
        <div className="h-1.5" style={{ background: "linear-gradient(90deg,#f0d487,#cfa94f 60%,#b8892a)" }} />
        <div className="flex flex-wrap items-start justify-between gap-6 px-6 pt-9 sm:px-11">
          <div className="flex min-w-0 items-center gap-4">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="Logo" className="size-16 flex-none rounded-xl object-contain" />
            ) : (
              <div className="grid size-16 flex-none place-items-center rounded-xl bg-[#201e1d] text-2xl font-bold tracking-[0.04em] text-[#f0d487]">{initials(profile.name)}</div>
            )}
            <div className="min-w-0">
              <div className="text-[26px] leading-[1.1] font-bold tracking-[0.06em] uppercase">{profile.name}</div>
              {profile.tagline && <div className="mt-1 text-[11px] tracking-[0.28em] text-[#8a6612] uppercase">{profile.tagline}</div>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-semibold tracking-[0.22em] text-[#605d5d] uppercase">{rate ? "Tax invoice" : "Invoice"}</div>
            <h1 className="m-0 mt-0.5 text-[26px] font-bold tracking-[0.02em]">{inv.number}</h1>
            <div className="mt-2 inline-block rounded px-2.5 py-1 text-[11px] font-bold tracking-[0.14em] text-white" style={{ background: statusBg }}>
              {statusLabel}
            </div>
          </div>
        </div>
        <div className="grid gap-x-7 gap-y-5 px-6 pt-[22px] sm:px-11 [grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr))]">
          <div>
            <div className={LBL}>From</div>
            <div className="text-[13.5px] leading-[1.6]">
              <strong>{profile.name}</strong>
              <br />
              <span className="whitespace-pre-line">{profile.address || inv.branch.address}</span>
              <br />
              {[profile.phone || inv.branch.phone, profile.email].filter(Boolean).join(" · ")}
              {gstin && (
                <>
                  <br />
                  GSTIN {gstin}
                </>
              )}
            </div>
          </div>
          <div>
            <div className={LBL}>Bill to</div>
            <div className="text-[13.5px] leading-[1.6]">
              <strong>{inv.member.name}</strong>
              <br />
              Member ID {inv.member.code}
              <br />
              {inv.member.phone}
              {inv.member.email && (
                <>
                  <br />
                  {inv.member.email}
                </>
              )}
            </div>
          </div>
          <div>
            <div className={LBL}>Details</div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 text-[13.5px] leading-[1.6]">
              <span className="text-[#605d5d]">Invoice date</span>
              <span>{fmtDate(inv.date)}</span>
              <span className="text-[#605d5d]">Due date</span>
              <span>{fmtDate(inv.dueDate)}</span>
              {inv.membership && (
                <>
                  <span className="text-[#605d5d]">Plan</span>
                  <span>{inv.membership.plan.name}</span>
                  <span className="text-[#605d5d]">Period</span>
                  <span>
                    {fmtDate(inv.membership.startDate)} – {fmtDate(inv.membership.endDate)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <ScrollRegion label="Invoice lines" className="px-6 pt-7 sm:px-11">
          <table className="w-full min-w-[480px] border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b-2 border-[#201e1d]">
                <th className={cx2(TH2, "text-left")}>Description</th>
                {["Qty", "Rate", "Discount", "Tax", "Amount"].map((h) => (
                  <th key={h} className={cx2(TH2, "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inv.items.map((it) => {
                const g = it.qty * it.rate - (it.discount || 0);
                const lineTax = Math.round((g * Number(it.taxRate || 0)) / 100);
                return (
                  <tr key={it.id} className="border-b border-[#e4e0d8]">
                    <td className="py-[13px]">{it.description}</td>
                    <td className="py-[13px] pl-3 text-right whitespace-nowrap">{it.qty}</td>
                    <td className="py-[13px] pl-3 text-right whitespace-nowrap">{money(it.rate)}</td>
                    <td className="py-[13px] pl-3 text-right whitespace-nowrap">{it.discount ? money(it.discount) : "—"}</td>
                    <td className="py-[13px] pl-3 text-right whitespace-nowrap">{Number(it.taxRate) ? `${money(lineTax)} (${Number(it.taxRate)}%)` : "—"}</td>
                    <td className="py-[13px] pl-3 text-right font-semibold whitespace-nowrap">{money(g + lineTax)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
        <div className="flex flex-wrap items-start justify-between gap-8 px-6 pt-[22px] sm:px-11">
          <div className="flex max-w-[340px] flex-[1_1_240px] flex-col gap-3.5 text-[13px]">
            <div>
              <div className={LBL}>Amount in words</div>
              <div className="leading-normal italic">{inWords(inv.total / 100)}</div>
            </div>
            <div>
              <div className={LBL}>Payments received</div>
              <div className="flex flex-col gap-[3px] leading-normal">
                {okPays.map((p) => (
                  <div key={p.id}>
                    {fmtDate(p.date)} · {p.method}
                    {p.txnRef ? ` · ${p.txnRef}` : ""} · {money(p.amount)}
                    {p.status === "REVERSED" ? " · reversed" : ""}
                  </div>
                ))}
                {!okPays.length && <div className="text-[#605d5d]">No payment received yet.</div>}
              </div>
              {cancelled && (
                <div className="mt-1.5 text-[#aa0b56]">
                  Cancelled by {inv.staffName(inv.cancelledById ?? "")}: {inv.cancelReason}
                </div>
              )}
            </div>
          </div>
          <div className="flex min-w-[280px] flex-[0_1_300px] flex-col rounded-[10px] border border-[#ece8e0] bg-[#f7f5f1] px-[18px] py-3.5">
            {totals.map(([k, v, bold, size]) => (
              <div key={k} className="flex justify-between gap-6 py-[5px]" style={{ fontSize: size ?? "14px", fontWeight: bold ? 600 : 400 }}>
                <span>{k}</span>
                <span className="whitespace-nowrap">{v}</span>
              </div>
            ))}
            {inv.balance > 0 && !cancelled && (
              <div className="mt-2 flex justify-between gap-6 rounded-lg bg-[#fff1f4] px-3 py-2.5 text-[15px] font-bold text-[#790e3d]">
                <span>Balance due</span>
                <span>{money(inv.balance)}</span>
              </div>
            )}
            {paid && (
              <div className="mt-2 flex justify-between gap-6 rounded-lg bg-[#e8f5ee] px-3 py-2.5 text-[15px] font-bold text-[#146c43]">
                <span>Paid in full</span>
                <span>{money(inv.paid)}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-6 px-6 pt-[26px] sm:px-11">
          <div className="max-w-[420px]">
            <div className="text-sm italic">Thank you for choosing {profile.name}.</div>
            <div className="mt-1.5 text-[11.5px] leading-[1.55] text-[#605d5d]">
              {cancelled
                ? "This invoice has been cancelled and is void. Any payments against it have been reversed."
                : inv.balance > 0
                  ? `Please clear the balance by ${fmtDate(inv.dueDate)}. Membership benefits continue only while dues are settled.`
                  : "Paid in full. Fees once paid are non-refundable and non-transferable."}
            </div>
          </div>
          <div className="text-center text-[11.5px] text-[#605d5d]">
            <div className="h-11 w-[190px]" />
            <div className="border-t border-[#201e1d] pt-[5px]">Authorised signatory · {profile.name}</div>
          </div>
        </div>
        <div className="mt-[26px] flex flex-wrap justify-between gap-3 border-t border-[#ece8e0] bg-[#f7f5f1] px-6 py-3 text-[11px] text-[#605d5d] sm:px-11">
          <span>{profile.instagram}</span>
          <span>Computer-generated invoice · no signature required · Powered by Fitron</span>
        </div>
      </div>
      <div className="mt-2 flex flex-col gap-4 print:hidden">
        {!cancelled && inv.balance > 0 && u.can("payments.collect") && (
          <Card title="Collect payment" className="scroll-mt-24" id="collect">
            <CollectForm invoiceId={inv.id} balance={inv.balance} today={todayIso()} />
          </Card>
        )}
        {inv.payments.some((p) => p.status === "SUCCESS") && !cancelled && u.can("payments.reverse") && (
          <Card title="Payments">
            <ul className="divide-y divide-line text-sm">
              {inv.payments.map((p) => (
                <li key={p.id} className="flex flex-col gap-2 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      <span className="font-semibold">{formatInr(p.amount)}</span> · {p.method}
                    </span>
                    {p.status === "REVERSED" ? <Badge tone="alert">Reversed</Badge> : <Badge tone="ok">Received</Badge>}
                  </div>
                  <div className="text-muted">
                    {p.code} · {fmtDate(p.date)} · {inv.staffName(p.receivedById)}
                    {p.txnRef ? ` · Ref ${p.txnRef}` : ""}
                  </div>
                  {p.status === "REVERSED" && <div className="text-muted">Reason: {p.reverseReason}</div>}
                  {p.status === "SUCCESS" && <ReversePayment paymentId={p.id} invoiceId={inv.id} />}
                </li>
              ))}
            </ul>
          </Card>
        )}
        {!cancelled && u.can("invoices.cancel") && (
          <Card>
            <CancelInvoice invoiceId={inv.id} />
          </Card>
        )}
      </div>
    </div>
  );
}
