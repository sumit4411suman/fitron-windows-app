import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { isFitronAdmin } from "@/lib/integrations/fitron-team";
import { platformGyms, type GymStanding } from "@/lib/services/platform-admin";
import { todayIso } from "@/lib/services/time";
import { Badge, Card, Empty, Input, PageHeader, Pager, Select, TABLE, TD, TH, TR, type Tone, ScrollRegion } from "@/components/ui";
import { fmtShort, fmtStamp, formatRupees } from "@/lib/format";
import { AdminTabs } from "../tabs";

export const metadata = { title: "Gyms · FITRON admin" };

const STANDING: Record<GymStanding, [string, Tone]> = { PAID: ["Paid", "ok"], TRIAL: ["Trial", "accent"], GRACE: ["Grace", "neutral"], LAPSED: ["Plan ended", "neutral"], CUSTOM: ["Custom", "neutral"] };
const PAGE = 50;

/** FITRON team only: every gym on the product with its owner, plan, people and what it has paid. */
export default async function GymsPage({ searchParams }: PageProps<"/fitron-admin/gyms">) {
  const u = await requireUser();
  if (!isFitronAdmin(u.email)) notFound();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const q = str("q").slice(0, 100);
  const status = (Object.keys(STANDING).includes(str("status")) ? str("status") : "") as GymStanding | "";
  const page = Math.max(1, Number(str("page")) || 1);
  const gyms = await platformGyms({ q, status, page, pageSize: PAGE }, todayIso());
  const href = (p: number) => `/fitron-admin/gyms?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Gyms" subtitle="Every gym on FITRON, with its owner, plan, people and what it has paid FITRON." />
      <AdminTabs current="/fitron-admin/gyms" />
      <Card title={`Gyms · ${gyms.total}`}>
        <form className="mb-4 flex flex-wrap gap-2" action="/fitron-admin/gyms">
          <Input name="q" defaultValue={q} placeholder="Gym, owner name, email or phone" className="max-w-[320px] flex-1" />
          <Select name="status" defaultValue={status}>
            <option value="">Every plan state</option>
            {(Object.entries(STANDING) as [GymStanding, [string, Tone]][]).map(([k, [l]]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          <button className="inline-flex py-2.5 leading-[1.2] items-center rounded-md border border-line px-[18px] text-sm font-semibold hover:bg-fg/7">Search</button>
        </form>
        {gyms.rows.length === 0 ? (
          <Empty>No gyms match.</Empty>
        ) : (
          <ScrollRegion label="Gyms on FITRON">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Gym</th>
                  <th className={TH}>Owner</th>
                  <th className={TH}>Plan</th>
                  <th className={`${TH} text-right`}>Branches</th>
                  <th className={`${TH} text-right`}>Staff</th>
                  <th className={`${TH} text-right`}>Members</th>
                  <th className={TH}>Joined</th>
                  <th className={TH}>Last login</th>
                  <th className={`${TH} text-right`}>Paid FITRON</th>
                </tr>
              </thead>
              <tbody>
                {gyms.rows.map((g) => {
                  const [label, tone] = STANDING[g.standing];
                  return (
                    <tr key={g.id} className={TR}>
                      <td className={`${TD} font-medium`}>{g.name}</td>
                      <td className={TD}>
                        {g.owner ? (
                          <>
                            <div>{g.owner.name}</div>
                            <div className="text-xs text-muted">
                              {g.owner.email} · {g.owner.phone}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className={TD}>
                        <Badge tone={tone}>{label}</Badge>{" "}
                        <span className="text-xs text-muted">
                          {g.planName} · {g.cycle === "YEARLY" ? "yearly" : "monthly"}
                          {g.until && g.standing !== "CUSTOM" ? ` · ${g.standing === "TRIAL" ? "trial till" : g.standing === "LAPSED" ? "ended" : "till"} ${fmtShort(g.until)}` : ""}
                        </span>
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>{g.branches}</td>
                      <td className={`${TD} text-right tabular-nums`}>{g.staff}</td>
                      <td className={`${TD} text-right tabular-nums`}>{g.members}</td>
                      <td className={TD}>{fmtStamp(g.createdAt)}</td>
                      <td className={TD}>{g.lastLoginAt ? fmtStamp(g.lastLoginAt) : "—"}</td>
                      <td className={`${TD} text-right tabular-nums`}>{formatRupees(g.paid)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
        )}
        <Pager page={gyms.page} pageSize={PAGE} total={gyms.total} href={href} />
      </Card>
    </>
  );
}
