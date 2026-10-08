import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { getProduct, isLow, PRODUCT_CATEGORIES } from "@/lib/services/pos";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { fmtStamp, formatInr } from "@/lib/format";
import { ProductForm, StockForm } from "../product-forms";
import { toggleProduct } from "../actions";

export const metadata = { title: "Product · Fitron" };

const REASON = { SALE: "Sold", RESTOCK: "Received", ADJUST: "Adjusted", RETURN: "Returned (invoice cancelled)" } as const;

export default async function ProductPage({ params }: PageProps<"/products/[id]">) {
  const u = await requirePermission("products.manage");
  const { id } = await params;
  const p = await getProduct(u, id);
  if (!p) notFound();
  const money = (n: number) => String(n / 100);
  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {p.sku} · {formatInr(p.price)} · {p.stock === null ? "no stock tracking" : `${p.stock} in stock`}
            {isLow(p) && <Badge tone="alert">Reorder</Badge>}
            {!p.active && <Badge>Not sold</Badge>}
          </span>
        }
        actions={
          <form action={toggleProduct.bind(null, p.id, !p.active)}>
            <ConfirmButton confirm={p.active ? "Stop selling this product? Its history stays." : "Start selling this product again?"}>{p.active ? "Stop selling" : "Sell again"}</ConfirmButton>
          </form>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          {p.stock !== null && (
            <Card title="Receive or write off stock" id="stock">
              <StockForm id={p.id} />
            </Card>
          )}
          <Card title="Stock history">
            {p.movements.length === 0 ? (
              <p className="text-sm text-muted">No stock movements yet.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {p.movements.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 py-2">
                    <span className="w-24 text-muted">{fmtStamp(m.createdAt)}</span>
                    <span className="flex-1">
                      {REASON[m.reason as keyof typeof REASON] ?? m.reason}
                      {m.note ? ` · ${m.note}` : ""}
                    </span>
                    <span className={`w-12 text-right tabular-nums ${m.qty < 0 ? "text-alert" : "text-ok"}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title="Details">
          <ProductForm
            id={p.id}
            categories={PRODUCT_CATEGORIES}
            values={{ name: p.name, sku: p.sku, category: p.category, price: money(p.price), cost: money(p.cost), reorderLevel: p.reorderLevel == null ? "" : String(p.reorderLevel), trackStock: p.stock === null ? "off" : "on", gstApplicable: p.gstApplicable ? "on" : "off" }}
          />
        </Card>
      </div>
    </>
  );
}
