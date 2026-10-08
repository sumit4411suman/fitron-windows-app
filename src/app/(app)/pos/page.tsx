import Link from "next/link";
import { PlusIcon, ShoppingCartIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { addDays } from "@/lib/domain/dates";
import { isLow, listProducts, soldSince } from "@/lib/services/pos";
import { memberScope, summarize } from "@/lib/services/members";
import { getTax } from "@/lib/services/tax";
import { todayIso } from "@/lib/services/time";
import { Dialog, DialogButtons } from "@/components/dialog";
import { Tag } from "@/components/tag";
import { Input, LinkButton, ListHeader, Notice, TABLE, TD, TH, cx, ScrollRegion } from "@/components/ui";
import { formatRupees } from "@/lib/format";
import { Terminal } from "./terminal";
import { restockAction } from "./actions";

export const metadata = { title: "POS & inventory · Fitron" };

const R = "text-right";

export default async function PosPage({ searchParams }: PageProps<"/pos">) {
  const u = await requirePermission("pos.sell");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const manage = u.can("products.manage");
  const pickBranch = u.branch === "ALL" && u.branchIds.length > 1;
  const branchId = u.branch === "ALL" ? u.branchIds[0] : u.branch;
  const today = todayIso();
  const [products, tax, people] = await Promise.all([
    listProducts(u),
    getTax(u.orgId),
    db.member.findMany({ where: { ...memberScope(u), walkIn: false, suspended: false }, select: { id: true, code: true, name: true, phone: true }, orderBy: { name: "asc" } }),
  ]);
  const [sums, sold] = await Promise.all([
    summarize(people.map((m) => m.id), today),
    manage ? soldSince(products.map((p) => p.id), addDays(today, -30)) : Promise.resolve(new Map<string, number>()),
  ]);
  const here = products.filter((p) => p.active && p.branchId === branchId);
  const restock = manage && str("restock") ? products.find((p) => p.id === str("restock") && p.stock !== null) : undefined;

  return (
    <div className="flex flex-col gap-7">
      <ListHeader kicker="Front desk sales · stock updates automatically" title="POS & inventory" />
      {str("msg") && <Notice tone="ok">{str("msg")}</Notice>}

      {pickBranch ? (
        <Notice>Pick a branch at the top of the page first. Each branch sells from its own stock.</Notice>
      ) : (
        <Terminal
          taxRate={tax.enabled ? tax.rate : 0}
          members={people.map((m) => ({ code: m.code, name: m.name, phone: m.phone, plan: sums.get(m.id)?.planName ?? "", due: sums.get(m.id)?.outstanding ?? 0 }))}
          products={here.map((p) => ({ id: p.id, sku: p.sku, name: p.name, category: p.category, price: p.price, stock: p.stock, low: isLow(p), gst: p.gstApplicable }))}
        />
      )}

      {manage && (
        <section id="inventory">
          <div className="mb-2.5 flex flex-wrap items-end justify-between gap-3">
            <h3 className="text-xl">Inventory</h3>
            <div className="flex flex-wrap gap-2">
              <LinkButton href="/purchases/new" variant="primary">
                <ShoppingCartIcon size={16} weight="duotone" />
                Purchase stock
              </LinkButton>
              <LinkButton href="/products/new">
                <PlusIcon size={16} weight="duotone" />
                New product
              </LinkButton>
            </div>
          </div>
          <ScrollRegion label="Pos table">
            <table className={TABLE}>
              <thead>
                <tr>
                  {["SKU", "Product", "Category", "Price", "Cost", "In stock", "Reorder at", "Sold (30 d)", "Status", ""].map((h, i) => (
                    <th key={i} className={cx(TH, i >= 3 && i <= 7 && R)}>
                      {h || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className={cx("hover:bg-fg/4", !p.active && "text-muted")}>
                    <td className={cx(TD, "whitespace-nowrap")}>{p.sku}</td>
                    <td className={TD}>
                      <Link href={`/products/${p.id}`} className="hover:text-accent">
                        {p.name}
                      </Link>
                      {u.branchIds.length > 1 && <span className="block text-xs text-muted">{p.branch.name}</span>}
                    </td>
                    <td className={TD}>{p.category}</td>
                    <td className={cx(TD, R)}>{formatRupees(p.price)}</td>
                    <td className={cx(TD, R)}>{formatRupees(p.cost)}</td>
                    <td className={cx(TD, R)}>{p.stock ?? "—"}</td>
                    <td className={cx(TD, R)}>{p.reorderLevel ?? "—"}</td>
                    <td className={cx(TD, R)}>{sold.get(p.id) ?? 0}</td>
                    <td className={TD}>{!p.active ? <Tag label="Not sold" /> : <Tag label={p.stock === null ? "Service" : isLow(p) ? "Low stock" : "In stock"} />}</td>
                    <td className={TD}>
                      {p.stock !== null && (
                        <Link href={`/pos?restock=${p.id}`} scroll={false} className="inline-flex py-2.5 leading-[1.2] items-center rounded-md px-1.5 text-sm font-semibold text-accent hover:bg-accent/10">
                          Restock
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          {!products.length && <p className="text-sm text-muted">No products yet.</p>}
        </section>
      )}

      {restock && (
        <Dialog kicker={restock.name} title="Restock" close="/pos" error={str("err")} note={`${restock.stock} in stock now${restock.reorderLevel != null ? `, reorder at ${restock.reorderLevel}` : ""}. The average cost updates with what you paid.`}>
          <form action={restockAction.bind(null, restock.id)} className="flex flex-col gap-3.5">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-[5px] text-sm">
                <span className="text-xs text-fg/70">Quantity</span>
                <Input name="qty" type="number" min={1} defaultValue={Math.max((restock.reorderLevel ?? 0) * 2 - (restock.stock ?? 0), 1)} required />
              </label>
              <label className="flex flex-col gap-[5px] text-sm">
                <span className="text-xs text-fg/70">Cost per unit (₹)</span>
                <Input name="unitCost" inputMode="decimal" defaultValue={restock.cost / 100} />
              </label>
            </div>
            <label className="flex flex-col gap-[5px] text-sm">
              <span className="text-xs text-fg/70">Vendor</span>
              <Input name="vendor" placeholder="Supplier name" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="asExpense" defaultChecked className="accent-[var(--accent)]" />
              Record the purchase as an Inventory expense
            </label>
            <DialogButtons close="/pos" label="Restock" />
          </form>
        </Dialog>
      )}
    </div>
  );
}
