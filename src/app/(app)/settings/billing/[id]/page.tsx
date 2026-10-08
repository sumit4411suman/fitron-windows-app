import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { getBillingInvoice } from "@/lib/services/saas";
import { gstSplit, SAAS_GST_RATE } from "@/lib/domain/saas";
import { findPlan } from "@/lib/domain/pricing";
import { fmtDate, fmtStamp, formatInr } from "@/lib/format";
import { Card, LinkButton, Notice, PageHeader, ScrollRegion } from "@/components/ui";
import { PrintButton } from "./print-button";

export const metadata = { title: "Fitron invoice · Fitron" };

const Row = ({ label, value }: { label: string; value: number }) => (
  <div className="flex justify-between gap-4 py-1">
    <dt className="text-muted">{label}</dt>
    <dd className="tabular-nums">{formatInr(value)}</dd>
  </div>
);

export default async function FitronInvoicePage({ params }: PageProps<"/settings/billing/[id]">) {
  const u = await requirePermission("settings.manage");
  const { id } = await params;
  const inv = await getBillingInvoice(u, id);
  if (!inv) notFound();
  const { sub, seller, buyer, branch } = inv;
  const g = gstSplit(seller.gstin, buyer.gstin, sub.gst);

  return (
    <>
      <PageHeader
        title={`Invoice ${sub.invoiceNo}`}
        actions={
          <>
            <LinkButton href="/settings/billing">Back</LinkButton>
            <PrintButton />
          </>
        }
      />
      {sub.mode === "DEMO" && (
        <div className="mb-4 print:hidden">
          <Notice>Demo payment: this is a sample, not a tax invoice.</Notice>
        </div>
      )}
      <Card>
        <div className="flex flex-col gap-6 text-sm">
          <div className="flex flex-wrap justify-between gap-4">
            <div>
              <p className="text-base font-semibold">{seller.name}</p>
              {seller.address && <p className="text-muted">{seller.address}</p>}
              {seller.gstin && <p className="text-muted">GSTIN {seller.gstin}</p>}
            </div>
            <div className="text-right">
              <p className="text-base font-semibold">{sub.mode === "DEMO" ? "Sample invoice" : "Tax invoice"}</p>
              <p>{sub.invoiceNo}</p>
              <p className="text-muted">{fmtStamp(sub.paidAt)}</p>
            </div>
          </div>
          <div>
            <p className="text-muted">Billed to</p>
            <p className="font-medium">{buyer.name}</p>
            {buyer.address && <p className="text-muted">{buyer.address}</p>}
            {buyer.email && <p className="text-muted">{buyer.email}</p>}
            {buyer.gstin && <p className="text-muted">GSTIN {buyer.gstin}</p>}
          </div>
          <ScrollRegion label="Subscription payment details">
            <table className="w-full min-w-[420px]">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 font-normal">Description</th>
                  <th className="py-1 font-normal">SAC</th>
                  <th className="py-1 text-right font-normal">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line">
                  <td className="py-2">
                    {sub.kind === "PLAN" ? `FITRON Gym Accounting, ${findPlan(sub.plan)?.name ?? sub.plan} plan` : `FITRON extra branch${branch ? ` (${branch.name})` : ""}`},{" "}
                    {sub.cycle === "YEARLY" ? "yearly" : "monthly"}
                    <br />
                    <span className="text-muted">
                      {fmtDate(sub.periodStart)} to {fmtDate(sub.periodEnd)}
                    </span>
                    {sub.couponCode && (
                      <>
                        <br />
                        <span className="text-muted">
                          Coupon {sub.couponCode}: {formatInr(sub.discount)} off the listed price (GST included)
                        </span>
                      </>
                    )}
                  </td>
                  <td className="py-2">997331</td>
                  <td className="py-2 text-right tabular-nums">{formatInr(sub.base)}</td>
                </tr>
              </tbody>
            </table>
          </ScrollRegion>
          <dl className="ml-auto w-full max-w-xs">
            <Row label="Taxable value" value={sub.base} />
            {g.type === "IGST" ? (
              <Row label={`IGST ${SAAS_GST_RATE}%`} value={g.igst} />
            ) : (
              <>
                <Row label={`CGST ${SAAS_GST_RATE / 2}%`} value={g.cgst} />
                <Row label={`SGST ${SAAS_GST_RATE / 2}%`} value={g.sgst} />
              </>
            )}
            <div className="mt-1 flex justify-between gap-4 border-t border-line pt-2 font-semibold">
              <dt>Total paid</dt>
              <dd className="tabular-nums">{formatInr(sub.total)}</dd>
            </div>
          </dl>
          {sub.razorpayPaymentId && <p className="text-muted">Paid online · Razorpay {sub.razorpayPaymentId}</p>}
        </div>
      </Card>
    </>
  );
}
