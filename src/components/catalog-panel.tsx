"use client";

/**
 * Phase 2 (ADR-0018) — Catalog panel: products with independent USD/CDF
 * prices, low-stock threshold, unaccent search, and categories.
 *
 * Pedagogy (ADR-0004 / D8): a product with stock history is DEACTIVATED, not
 * erased; the delete button surfaces the server's 409 message. Deactivated
 * products stay visible (muted) and can be re-activated.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ImagePlus,
  Package,
  PackagePlus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  ApiErrorText,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
} from "@/components/ui";
import { deleteJson, getJson, postJson } from "@/lib/http-client";
import { formatMinor, toMinor } from "@/lib/money";

interface Category {
  id: string;
  name: string;
  sortOrder: number;
  icon: string | null;
  color: string | null;
}
interface Product {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  kind: "product" | "service";
  unit: string;
  isActive: boolean;
  lowStockThreshold: number | null;
  taxFree: boolean;
  categoryId: string | null;
  categoryName: string | null;
  imageUrl: string | null;
  priceUsdMinor: number | null;
  priceCdfMinor: number | null;
  totalStock: number | null;
  lowStock: boolean;
}

export function CatalogPanel({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => getJson<Category[]>("/api/categories"),
  });

  // Debounced search: state → debounced value → query.
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const products = useQuery({
    queryKey: ["products", dq],
    queryFn: () =>
      getJson<Product[]>(
        `/api/products?includeInactive=1${dq ? `&q=${encodeURIComponent(dq)}` : ""}`,
      ),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  }

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState<"product" | "service">("product");
  const [unit, setUnit] = useState("pièce");
  const [sku, setSku] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [priceCdf, setPriceCdf] = useState("");
  const [threshold, setThreshold] = useState("");
  const [taxFree, setTaxFree] = useState(false);
  const [costUsd, setCostUsd] = useState("");
  const [costCdf, setCostCdf] = useState("");
  // ADR-0022: product photo (data URL, built from the picked file).
  const [imageData, setImageData] = useState("");

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

  async function create() {
    const prices: { USD?: number; CDF?: number } = {};
    if (priceUsd.trim()) prices.USD = toMinor(Number(priceUsd), "USD");
    if (priceCdf.trim()) prices.CDF = toMinor(Number(priceCdf), "CDF");
    await run("create", async () => {
      if (!prices.USD && !prices.CDF)
        throw new Error("Indiquez au moins un prix (USD ou CDF).");
      const body: Record<string, unknown> = {
        name: name.trim(),
        categoryId: category || null,
        kind,
        unit: unit.trim() || "pièce",
        taxFree,
        prices,
      };
      if (sku.trim()) body.sku = sku.trim();
      if (threshold.trim()) body.lowStockThreshold = Number(threshold);
      if (costUsd.trim()) body.costUsdMinor = toMinor(Number(costUsd), "USD");
      if (costCdf.trim()) body.costCdfMinor = toMinor(Number(costCdf), "CDF");
      if (imageData) body.imageUrl = imageData;
      await postJson("/api/products", body);
      setName("");
      setCategory("");
      setKind("product");
      setUnit("pièce");
      setSku("");
      setPriceUsd("");
      setPriceCdf("");
      setThreshold("");
      setTaxFree(false);
      setCostUsd("");
      setCostCdf("");
      setImageData("");
      setOpen(false);
    });
  }

  async function setActive(p: Product, isActive: boolean) {
    await run(
      `toggle-${p.id}`,
      () => postJson(`/api/products/${p.id}`, { isActive }),
    );
  }

  async function remove(p: Product) {
    if (
      !confirm(
        `Supprimer « ${p.name} » ? Impossible s'il a un historique de stock (désactivez-le plutôt).`,
      )
    )
      return;
    await run(`del-${p.id}`, () => deleteJson(`/api/products/${p.id}`));
  }

  return (
    <Card
      title="Catalogue"
      subtitle="Produits et services — prix USD et CDF indépendants, aucune conversion."
      icon={Package}
    >
      <div className="space-y-4">
        {/* Search + create */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher (nom, SKU, code-barres) — sans accents"
              className="pl-9"
            />
          </div>
          {canEdit && (
            <Button
              variant={open ? "outline" : "primary"}
              className="min-h-10"
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <X className="size-4" /> : <PackagePlus className="size-4" />}
              <span className="hidden sm:inline">Nouveau produit</span>
            </Button>
          )}
        </div>

        {/* Create form */}
        {open && canEdit && (
          <div className="space-y-3 rounded-card border border-border bg-surface p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nom">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Huile 1L" />
              </Field>
              <Field label="Catégorie">
                <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">— aucune —</option>
                  {(categories.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Type">
                <Select value={kind} onChange={(e) => setKind(e.target.value as "product" | "service")}>
                  <option value="product">Produit (stocké)</option>
                  <option value="service">Service (pas de stock)</option>
                </Select>
              </Field>
              <Field label="Unité">
                <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pièce, litre…" />
              </Field>
              <Field label="Référence SKU (optionnel)">
                <Input value={sku} onChange={(e) => setSku(e.target.value)} />
              </Field>
              <Field label="Seuil d'alerte stock (optionnel)">
                <Input
                  type="number"
                  min={0}
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  placeholder="ex. 5"
                />
              </Field>
              <Field label="Prix USD">
                <Input type="number" min={0} step="0.01" value={priceUsd} onChange={(e) => setPriceUsd(e.target.value)} placeholder="2.50" />
              </Field>
              <Field label="Prix CDF">
                <Input type="number" min={0} step="1" value={priceCdf} onChange={(e) => setPriceCdf(e.target.value)} placeholder="5000" />
              </Field>
              <Field label="Coût USD (interne, optionnel)">
                <Input type="number" min={0} step="0.01" value={costUsd} onChange={(e) => setCostUsd(e.target.value)} placeholder="1.80" />
              </Field>
              <Field label="Coût CDF (interne, optionnel)">
                <Input type="number" min={0} step="1" value={costCdf} onChange={(e) => setCostCdf(e.target.value)} placeholder="4500" />
              </Field>
            </div>
            <label className="flex items-center gap-2 rounded-control bg-surface-inset p-2.5">
              <input
                type="checkbox"
                checked={taxFree}
                onChange={(e) => setTaxFree(e.target.checked)}
                className="size-4"
              />
              <span className="text-sm font-medium">
                En franchise de taxe (pharmacie, agro)
              </span>
            </label>

            {/* ADR-0022: product photo */}
            <div className="space-y-1.5">
              <span className="text-sm font-semibold text-foreground">
                Photo du produit (optionnelle)
              </span>
              <div className="flex items-center gap-3">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 1_500_000) {
                      setError("Image trop lourde (max 1,5 MB).");
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => setImageData(reader.result as string);
                    reader.readAsDataURL(file);
                  }}
                  className="text-xs text-muted-foreground file:mr-3 file:rounded-control file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-primary"
                />
                {imageData ? (
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageData}
                      alt=""
                      className="size-12 rounded-control object-cover"
                    />
                    <Button
                      variant="ghost"
                      className="h-8 px-2 text-xs"
                      onClick={() => setImageData("")}
                    >
                      <X className="size-3.5" />
                      Retirer
                    </Button>
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <ImagePlus className="size-3.5" />
                    png, jpg, webp ou svg · 1,5 MB max
                  </span>
                )}
              </div>
            </div>

            <ApiErrorText error={error} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
              <Button onClick={create} disabled={busy === "create" || !name.trim()}>
                {busy === "create" ? <Spinner /> : "Créer le produit"}
              </Button>
            </div>
          </div>
        )}

        {/* List */}
        {products.isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (products.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={Package}
            title="Aucun produit"
            hint="Créez votre premier produit pour commencer."
          />
        ) : (
          <ul className="divide-y divide-border">
            {products.data?.map((p) => (
              <li
                key={p.id}
                className={`flex flex-wrap items-center justify-between gap-3 py-3 ${
                  p.isActive === false ? "opacity-60" : ""
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.imageUrl}
                      alt=""
                      className="size-11 shrink-0 rounded-control object-cover"
                    />
                  ) : (
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-control bg-surface-inset text-muted-foreground">
                      <Package className="size-4" aria-hidden />
                    </span>
                  )}
                  <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {p.name}
                    {p.kind === "service" && (
                      <span className="ml-2 inline-flex"><Badge>service</Badge></span>
                    )}
                    {p.taxFree && (
                      <span className="ml-2 inline-flex"><Badge tone="success">franchise</Badge></span>
                    )}
                    {p.lowStock && (
                      <span className="ml-2 inline-flex">
                        <Badge tone="warning">
                          <AlertTriangle className="mr-1 size-3" /> stock bas
                        </Badge>
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      p.categoryName,
                      p.sku,
                      p.totalStock !== null ? `${p.totalStock} en stock` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right text-sm tabular-nums">
                    <p>{p.priceUsdMinor != null ? formatMinor(p.priceUsdMinor, "USD") : "—"}</p>
                    <p className="text-muted-foreground">
                      {p.priceCdfMinor != null ? formatMinor(p.priceCdfMinor, "CDF") : "—"}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        onClick={() => setActive(p, !p.isActive)}
                      >
                        {p.isActive ? "Désactiver" : "Réactiver"}
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0 text-danger"
                        aria-label={`Supprimer ${p.name}`}
                        onClick={() => remove(p)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
