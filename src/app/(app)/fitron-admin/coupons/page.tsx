import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current";
import { isFitronAdmin } from "@/lib/integrations/fitron-team";
import { createCoupon, deleteCoupon, listCoupons, recentRedemptions, setCouponStatus } from "@/lib/services/coupons";
import { COUPON_AUDIENCES } from "@/lib/domain/coupons";
import { couponInput } from "@/lib/validation/coupon";
import { UserError } from "@/lib/services/errors";
import { Badge, Button, Card, Empty, Field, Input, Notice, PageHeader, Select, TABLE, TD, TH, TR, ScrollRegion, type Tone } from "@/components/ui";
import { fmtDate, fmtStamp, formatInr } from "@/lib/format";
import { AdminTabs } from "../tabs";

export const metadata = { title: "Coupons · FITRON" };

const STATE: Record<string, Tone> = { Active: "ok", Paused: "neutral", Expired: "alert", "Used up": "alert" };

const back = (params: Record<string, string>) => redirect(`/fitron-admin/coupons?${new URLSearchParams(params)}`);

/** Every action here is for the FITRON team only. */
async function admin() {
  const u = await requireUser();
  if (!isFitronAdmin(u.email)) notFound();
  return u;
}

async function addCoupon(fd: FormData) {
  "use server";
  const u = await admin();
  const parsed = couponInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) back({ error: parsed.error.issues[0]?.message ?? "Check the form." });
  try {
    await createCoupon(u.email, parsed.data!);
  } catch (e) {
    if (e instanceof UserError) back({ error: e.message });
    throw e;
  }
  revalidatePath("/fitron-admin/coupons");
  back({ saved: parsed.data!.code });
}

async function toggleCoupon(id: string, status: "ACTIVE" | "PAUSED") {
  "use server";
  await admin();
  try {
    await setCouponStatus(id, status);
  } catch (e) {
    if (e instanceof UserError) back({ error: e.message });
    throw e;
  }
  revalidatePath("/fitron-admin/coupons");
}

async function removeCoupon(id: string) {
  "use server";
  await admin();
  try {
    await deleteCoupon(id);
  } catch (e) {
    if (e instanceof UserError) back({ error: e.message });
    throw e;
  }
  revalidatePath("/fitron-admin/coupons");
  back({ removed: "1" });
}

/** FITRON team only (FITRON_ADMIN_EMAILS): make the coupon codes that gyms and AI Trainer members type before they pay. */
export default async function CouponsPage({ searchParams }: PageProps<"/fitron-admin/coupons">) {
  await admin();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const [coupons, recent] = await Promise.all([listCoupons(), recentRedemptions()]);
  return (
    <>
      <PageHeader title="Coupons" subtitle="Discount codes for payments to FITRON. A gym types one in Settings › Plan & billing, an AI Trainer member in the payment screen, before paying." />
      <AdminTabs current="/fitron-admin/coupons" />
      {str("error") && <Notice tone="alert">{str("error")}</Notice>}
      {str("saved") && <Notice tone="ok">Coupon {str("saved")} is live.</Notice>}
      {str("removed") && <Notice tone="ok">Coupon removed.</Notice>}

      <div className="flex flex-col gap-6">
        <Card title="New coupon">
          <form action={addCoupon} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Code" hint="What the customer types, like WELCOME99">
                <Input name="code" required minLength={3} maxLength={20} placeholder="WELCOME99" className="uppercase" autoComplete="off" />
              </Field>
              <Field label="Discount (%)" hint="99 takes 99% off. 100 makes it free.">
                <Input name="percentOff" type="number" required min={1} max={100} step={1} inputMode="numeric" placeholder="99" />
              </Field>
              <Field label="Or flat price (₹, optional)" hint="Fill this and the customer pays exactly this amount, whatever the plan costs. The percentage is then only a label. Minimum ₹1.">
                <Input name="payRupees" type="number" min={1} step={1} inputMode="numeric" placeholder="1" />
              </Field>
              <Field label="Works on">
                <Select name="appliesTo" defaultValue="ALL">
                  {Object.entries(COUPON_AUDIENCES).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Last day (optional)" hint="Leave empty for no end date">
                <Input name="validTill" type="date" />
              </Field>
              <Field label="Most uses (optional)" hint="In all, one per gym or member. Empty for no limit.">
                <Input name="usageLimit" type="number" min={1} step={1} inputMode="numeric" />
              </Field>
              <Field label="Note (optional)" hint="Only you see this">
                <Input name="description" maxLength={200} placeholder="Launch offer for gym owners" />
              </Field>
            </div>
            <p className="text-xs text-muted">A coupon is paid once at the reduced price and does not renew by itself. Each gym or member can use a coupon one time. A 100% coupon turns the plan on without any payment.</p>
            <div>
              <Button variant="primary">Create coupon</Button>
            </div>
          </form>
        </Card>

        <Card title={`Coupons · ${coupons.length}`}>
          {coupons.length === 0 ? (
            <Empty>No coupons yet. Make the first one above.</Empty>
          ) : (
            <ScrollRegion label="Coupons">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Code</th>
                    <th className={`${TH} text-right`}>Off</th>
                    <th className={TH}>Works on</th>
                    <th className={TH}>Last day</th>
                    <th className={`${TH} text-right`}>Used</th>
                    <th className={`${TH} text-right`}>Given away</th>
                    <th className={TH}>State</th>
                    <th className={TH}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {coupons.map((c) => (
                    <tr key={c.id} className={TR}>
                      <td className={TD}>
                        <div className="font-mono font-semibold">{c.code}</div>
                        {c.description && <div className="text-xs text-muted">{c.description}</div>}
                        <div className="text-xs text-muted">
                          {c.createdBy} · {fmtStamp(c.createdAt)}
                        </div>
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>{c.payPaise != null ? `Pay ${formatInr(c.payPaise)}` : `${c.percentOff}%`}</td>
                      <td className={TD}>{COUPON_AUDIENCES[c.appliesTo as keyof typeof COUPON_AUDIENCES] ?? c.appliesTo}</td>
                      <td className={`${TD} whitespace-nowrap`}>{c.validTill ? fmtDate(c.validTill) : "—"}</td>
                      <td className={`${TD} text-right tabular-nums`}>
                        {c.uses}
                        {c.usageLimit !== null ? ` of ${c.usageLimit}` : ""}
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>{formatInr(c.given)}</td>
                      <td className={TD}>
                        <Badge tone={STATE[c.state] ?? "neutral"}>{c.state}</Badge>
                      </td>
                      <td className={`${TD} whitespace-nowrap text-right`}>
                        <div className="flex justify-end gap-2">
                          <form action={toggleCoupon.bind(null, c.id, c.status === "ACTIVE" ? "PAUSED" : "ACTIVE")}>
                            <Button type="submit">{c.status === "ACTIVE" ? "Pause" : "Resume"}</Button>
                          </form>
                          {c.uses === 0 && (
                            <form action={removeCoupon.bind(null, c.id)}>
                              <Button type="submit" variant="danger">
                                Delete
                              </Button>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </Card>

        {recent.length > 0 && (
          <Card title="Recently used">
            <ScrollRegion label="Recent coupon payments">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>When</th>
                    <th className={TH}>Coupon</th>
                    <th className={TH}>Used by</th>
                    <th className={`${TH} text-right`}>Listed price</th>
                    <th className={`${TH} text-right`}>Discount</th>
                    <th className={`${TH} text-right`}>Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id} className={TR}>
                      <td className={TD}>{fmtStamp(r.usedAt)}</td>
                      <td className={`${TD} font-mono`}>{r.code}</td>
                      <td className={TD}>{r.who}</td>
                      <td className={`${TD} text-right tabular-nums`}>{formatInr(r.listTotal)}</td>
                      <td className={`${TD} text-right tabular-nums`}>{formatInr(r.discount)}</td>
                      <td className={`${TD} text-right tabular-nums`}>{formatInr(r.paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </Card>
        )}
      </div>
    </>
  );
}
