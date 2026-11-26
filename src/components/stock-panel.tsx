"use client";

/**
 * Phase 2 (ADR-0018) — Stock panel: derived positions per branch, new
 * movements (purchase / adjustment) and atomic inter-branch transfers.
 *
 * Pedagogy (ADR-0004 / D1): a movement is a DOCUMENT. There is no edit or
 * delete button anywhere in this panel — correcting a stock error means
 * recording a new `adjustment` with a mandatory reason. The history list is
 * intentionally read-only.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  History,
  PackagePlus,
} from "lucide-react";
import {
  ApiErrorText,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Segmented,
  Select,
  Spinner,
} from "@/components/ui";
import { getJson, postJson } from "@/lib/http-client";

interface Branch {
  id: string;
  name: string;
}
interface Product {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
}
interface Position {
  branchId: string;
  branchName: string;
  productId: string;
  productName: string;
  sku: string | null;
  unit: string;
  qty: number;
  lowStockThreshold: number | null;
  lowStock: boolean;
}
interface Movement {
  id: string;
  type: "purchase" | "adjustment" | "transfer_in" | "transfer_out" | "sale" | "return";
  qtyDelta: number;
  branchId: string;
  branchName: string | null;
  productName: string | null;
  sku: string | null;
  reference: string | null;
  reason: string | null;
  createdAt: string;
}

const TYPE_LABELS: Record<Movement["type"], string> = {
  purchase: "Achat",
  adjustment: "Ajustement",
  transfer_in: "Transfert entrant",
  transfer_out: "Transfert sortant",
  sale: "Vente",
  return: "Retour",
};

export function StockPanel({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();

  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: () => getJson<Branch[]>("/api/branches"),
  });
  const products = useQuery({
    queryKey: ["products-stock"],
    queryFn: () => getJson<Product[]>("/api/products"),
  });
  const positions = useQuery({
    queryKey: ["stock-positions"],
    queryFn: () => getJson<Position[]>("/api/stock"),
  });
  const movements = useQuery({
    queryKey: ["stock-movements"],
    queryFn: () => getJson<Movement[]>("/api/stock/movements?limit=30"),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["stock-positions"] });
    qc.invalidateQueries({ queryKey: ["stock-movements"] });
  }

  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState("");

  // Movement form -------------------------------------------------------------
  const [mType, setMType] = useState<"purchase" | "adjustment">("purchase");
  const [mBranch, setMBranch] = useState("");
  const [mProduct, setMProduct] = useState("");
  const [mQty, setMQty] = useState("");
  const [mDirection, setMDirection] = useState<"in" | "out">("in");
  const [mReason, setMReason] = useState("");

  // Transfer form -------------------------------------------------------------
  const [tFrom, setTFrom] = useState("");
  const [tTo, setTTo] = useState("");
  const [tProduct, setTProduct] = useState("");
  const [tQty, setTQty] = useState("");

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    try {
      await fn();
      invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(undefined);
    }
  }

  async function record() {
    await run("move", async () => {
      if (!mBranch) throw new Error("Choisissez la succursale.");
      if (!mProduct) throw new Error("Choisissez le produit.");
      const qty = Number(mQty);
      if (!Number.isInteger(qty) || qty < 1) throw new Error("Quantité invalide.");
      const body: Record<string, unknown> = {
        type: mType,
        branchId: mBranch,
        productId: mProduct,
        qty,
      };
      if (mType === "adjustment") {
        if (!mReason.trim() || mReason.trim().length < 3)
          throw new Error("Un motif est obligatoire pour un ajustement.");
        body.direction = mDirection;
        body.reason = mReason.trim();
      }
      await postJson("/api/stock/movements", body);
      setMQty("");
      setMReason("");
    });
  }

  async function transfer() {
    await run("transfer", async () => {
      if (!tFrom) throw new Error("Choisissez la succursale d'origine.");
      if (!tTo) throw new Error("Choisissez la succursale de destination.");
      if (tFrom === tTo) throw new Error("Origine et destination doivent différer.");
      if (!tProduct) throw new Error("Choisissez le produit.");
      const qty = Number(tQty);
      if (!Number.isInteger(qty) || qty < 1) throw new Error("Quantité invalide.");
      await postJson("/api/stock/transfer", {
        fromBranchId: tFrom,
        toBranchId: tTo,
        items: [{ productId: tProduct, qty }],
      });
      setTQty("");
    });
  }

  const stockProducts = (products.data ?? []).filter((p) => p.unit); // active goods

  return (
    <Card
      title="Stock"
      subtitle="Positions par succursale — registre append-only, corrigé par ajustement."
      icon={Boxes}
    >
      <div className="space-y-5">
        {/* Positions */}
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
            <Boxes className="size-4 text-muted-foreground" /> Positions
          </h3>
          {positions.isLoading ? (
            <div className="flex justify-center py-4"><Spinner /></div>
          ) : (positions.data?.length ?? 0) === 0 ? (
            <EmptyState icon={Boxes} title="Aucun stock" hint="Enregistrez un achat pour alimenter une succursale." />
          ) : (
            <ul className="divide-y divide-border">
              {positions.data?.map((p, i) => (
                <li key={`${p.branchId}-${p.productId}-${i}`} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{p.productName}</p>
                    <p className="truncate text-xs text-muted-foreground">{p.branchName}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {p.lowStock && (
                      <Badge tone="warning">
                        <AlertTriangle className="mr-1 size-3" /> bas
                      </Badge>
                    )}
                    <span className="text-sm font-bold tabular-nums">
                      {p.qty} <span className="font-normal text-muted-foreground">{p.unit}</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {canEdit && (
          <>
            {/* New movement */}
            <section className="space-y-3 rounded-card border border-border bg-surface p-3">
              <h3 className="flex items-center gap-2 text-sm font-bold">
                <PackagePlus className="size-4 text-muted-foreground" /> Nouveau mouvement
              </h3>
              <Segmented
                value={mType}
                onChange={setMType}
                options={[
                  { value: "purchase", label: "Achat" },
                  { value: "adjustment", label: "Ajustement" },
                ]}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Succursale">
                  <Select value={mBranch} onChange={(e) => setMBranch(e.target.value)}>
                    <option value="">— choisir —</option>
                    {(branches.data ?? []).map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Produit">
                  <Select value={mProduct} onChange={(e) => setMProduct(e.target.value)}>
                    <option value="">— choisir —</option>
                    {stockProducts.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Quantité">
                  <Input type="number" min={1} value={mQty} onChange={(e) => setMQty(e.target.value)} placeholder="10" />
                </Field>
                {mType === "adjustment" && (
                  <>
                    <Field label="Sens">
                      <Select value={mDirection} onChange={(e) => setMDirection(e.target.value as "in" | "out")}>
                        <option value="in">Entrée (+)</option>
                        <option value="out">Sortie (−)</option>
                      </Select>
                    </Field>
                    <Field label="Motif (obligatoire)">
                      <Input value={mReason} onChange={(e) => setMReason(e.target.value)} placeholder="Inventaire, casse…" />
                    </Field>
                  </>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <ApiErrorText error={busy === "move" || busy === "transfer" ? undefined : error} />
                <Button onClick={record} disabled={busy === "move"}>
                  {busy === "move" ? <Spinner /> : "Enregistrer"}
                </Button>
              </div>
            </section>

            {/* Transfer */}
            <section className="space-y-3 rounded-card border border-border bg-surface p-3">
              <h3 className="flex items-center gap-2 text-sm font-bold">
                <ArrowLeftRight className="size-4 text-muted-foreground" /> Transfert entre succursales
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Depuis">
                  <Select value={tFrom} onChange={(e) => setTFrom(e.target.value)}>
                    <option value="">— choisir —</option>
                    {(branches.data ?? []).map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Vers">
                  <Select value={tTo} onChange={(e) => setTTo(e.target.value)}>
                    <option value="">— choisir —</option>
                    {(branches.data ?? []).map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Produit">
                  <Select value={tProduct} onChange={(e) => setTProduct(e.target.value)}>
                    <option value="">— choisir —</option>
                    {stockProducts.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Quantité">
                  <Input type="number" min={1} value={tQty} onChange={(e) => setTQty(e.target.value)} placeholder="5" />
                </Field>
              </div>
              <div className="flex items-center justify-between gap-3">
                <ApiErrorText error={busy === "transfer" ? undefined : error} />
                <Button variant="outline" onClick={transfer} disabled={busy === "transfer"}>
                  {busy === "transfer" ? <Spinner /> : "Transférer"}
                </Button>
              </div>
            </section>
          </>
        )}

        {/* History — read-only by design (ADR-0004) */}
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
            <History className="size-4 text-muted-foreground" /> Historique
            <span className="text-xs font-normal text-muted-foreground">
              — sans édition : corriger = nouvel ajustement
            </span>
          </h3>
          {movements.isLoading ? (
            <div className="flex justify-center py-4"><Spinner /></div>
          ) : (movements.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun mouvement enregistré.</p>
          ) : (
            <ul className="divide-y divide-border">
              {movements.data?.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {TYPE_LABELS[m.type]} · {m.productName ?? "—"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {new Date(m.createdAt).toLocaleString("fr-FR")}
                      {m.branchName ? ` · ${m.branchName}` : ""}
                      {m.reference ? ` · ${m.reference}` : ""}
                      {m.reason ? ` · ${m.reason}` : ""}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-sm font-bold tabular-nums ${
                      m.qtyDelta >= 0 ? "text-success" : "text-danger"
                    }`}
                  >
                    {m.qtyDelta >= 0 ? "+" : ""}
                    {m.qtyDelta}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Card>
  );
}
