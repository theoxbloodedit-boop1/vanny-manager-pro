"use client";

import { useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Store,
  Printer,
  Plus,
  Trash2,
  Check,
  RefreshCw,
  Phone,
  Send,
  Receipt,
  Wifi,
  Package,
} from "lucide-react";
import {
  Button,
  Card,
  Input,
  Field,
  Select,
  Badge,
  ApiErrorText,
  EmptyState,
} from "@/components/ui";
import { Reveal } from "@/components/motion";
import {
  connectPrinter,
  disconnectPrinter,
  printTicket,
  buildTicket,
  type PrinterDevice,
} from "@/lib/printer";

interface Branch {
  id: string;
  name: string;
}
interface Product {
  id: string;
  name: string;
  prices?: { currency: string; amountMinor: string }[];
  stock?: number;
}
interface Customer {
  id: string;
  name: string;
  phone: string | null;
  creditMinor: string;
}
interface SaleItem {
  productId: string;
  name: string;
  qty: number;
  unitPriceMinor: number;
}
interface Sale {
  id: string;
  branchId: string;
  customerId: string | null;
  sellerName: string | null;
  totalMinor: string;
  currency: string;
  paymentMethod: string;
  status: string;
  createdAt: string;
}

const CURRENCY = "CDF";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Requête impossible");
  return data as T;
}
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Action impossible");
  return data as T;
}

function formatAmount(minor: number): string {
  return new Intl.NumberFormat("fr-FR").format(minor) + " " + CURRENCY;
}

export default function SalesPage() {
  const qc = useQueryClient();

  const [branchId, setBranchId] = useState("");
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [error, setError] = useState("");
  const [printer, setPrinter] = useState<PrinterDevice | null>(null);
  const [printerName, setPrinterName] = useState<string>("");

  const branches = useQuery<Branch[]>({
    queryKey: ["branches"],
    queryFn: () => getJson<Branch[]>("/api/branches"),
  });
  const products = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: () => getJson<Product[]>("/api/products"),
  });
  const customers = useQuery<Customer[]>({
    queryKey: ["customers"],
    queryFn: () => getJson<Customer[]>("/api/customers"),
  });
  const sales = useQuery<Sale[]>({
    queryKey: ["sales", branchId || "all"],
    queryFn: () => getJson<Sale[]>(`/api/sales?branchId=${branchId || ""}&limit=15`),
    enabled: Boolean(branchId),
  });

  const productPrice = (p: Product): number => {
    const price = p.prices?.find((pr) => pr.currency === CURRENCY) ?? p.prices?.[0];
    return price ? Number(price.amountMinor) : 0;
  };

  const addProduct = (p: Product) => {
    const price = productPrice(p);
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.productId === p.id);
      if (idx >= 0) {
        const next = [...prev];
        const item = next[idx]!;
        next[idx] = { ...item, qty: item.qty + 1 };
        return next;
      }
      return [...prev, { productId: p.id, name: p.name, qty: 1, unitPriceMinor: price }];
    });
  };
  const setQty = (productId: string, qty: number) => {
    setCart((prev) =>
      prev
        .map((c) => (c.productId === productId ? { ...c, qty: Math.max(1, qty) } : c))
        .filter((c) => c.qty > 0),
    );
  };
  const removeItem = (productId: string) => {
    setCart((prev) => prev.filter((c) => c.productId !== productId));
  };

  const totalMinor = cart.reduce((sum, c) => sum + c.qty * c.unitPriceMinor, 0);

  const chooseCustomer = (c: Customer) => {
    setCustomerId(c.id);
    setCustomerName(c.name);
    setCustomerPhone(c.phone ?? "");
    setCustomerSearch("");
  };

  const connectPrinterMut = useMutation({
    mutationFn: async () => {
      const p = await connectPrinter();
      setPrinter(p);
      setPrinterName(p.device.name ?? "Imprimante Bluetooth");
    },
    onError: (e: Error) => setError(e.message),
  });

  const disconnectPrinterMut = useMutation({
    mutationFn: async () => {
      await disconnectPrinter(printer);
      setPrinter(null);
      setPrinterName("");
    },
  });

  const doPrint = async (items: SaleItem[], seller: string) => {
    if (!printer) throw new Error("Connectez l’imprimante Bluetooth d’abord.");
    const branchName = branches.data?.find((b) => b.id === branchId)?.name ?? "";
    const dateLabel = new Date().toLocaleString("fr-FR");
    const total = items.reduce((s, c) => s + c.qty * c.unitPriceMinor, 0);
    const lines = buildTicket({
      orgName: "VANNY",
      branchName,
      dateLabel,
      items: items.map((c) => ({
        name: c.name,
        qty: c.qty,
        unitPrice: formatAmount(c.unitPriceMinor),
        total: formatAmount(c.qty * c.unitPriceMinor),
      })),
      total: formatAmount(total),
      payment: "COMPTANT",
      seller,
    });
    await printTicket(printer, "VANNY — Ticket de vente", lines);
  };

  const printMut = useMutation({
    mutationFn: () => doPrint(cart, customerName || "Vendeur"),
    onError: (e: Error) => setError(e.message),
  });

  const saveSaleMut = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("Choisissez une succursale.");
      if (cart.length === 0) throw new Error("Ajoutez au moins un article.");
      if (!customerName) throw new Error("Saisissez le nom du client.");
      return postJson("/api/sales", {
        branchId,
        currency: CURRENCY,
        paymentMethod: "cash",
        customerId: customerId ?? undefined,
        customerName,
        customerPhone: customerPhone || undefined,
        items: cart,
      });
    },
    onSuccess: async () => {
      const sold = cart;
      const soldCustomer = customerName;
      setCart([]);
      setCustomerName("");
      setCustomerPhone("");
      setCustomerId(null);
      setError("");
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      // Print the ticket automatically if a printer is connected.
      if (printer && sold.length > 0) {
        await doPrint(sold, soldCustomer || "Vendeur").catch(() => {});
      }
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <Reveal>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Store className="size-5 text-primary" />
            <h1 className="text-lg font-extrabold tracking-tight">Point de vente</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Vos ventes, votre caisse et votre stock dans votre téléphone.
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge tone="primary">Le suivi de vos crédits clients</Badge>
            <Badge tone="neutral">Un profil pour chaque membre de votre équipe</Badge>
            <Badge tone="neutral">Imprimante Bluetooth</Badge>
          </div>
        </div>
      </Reveal>

      {/* Sélection de succursale */}
      <Reveal delay={0.05}>
        <Card title="Succursale" icon={Store}>
          <Field label="Point de vente">
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">— choisir —</option>
              {branches.data?.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
        </Card>
      </Reveal>

      {/* Bluetooth imprimante */}
      <Reveal delay={0.08}>
        <Card title="Imprimante de vente (Bluetooth)" icon={Printer}
          subtitle="Connectez votre mini imprimante thermique pour imprimer les tickets.">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Wifi className={`size-4 ${printer ? "text-success" : "text-muted-foreground"}`} />
              <span className="text-sm font-semibold">
                {printer ? `Connectée : ${printerName}` : "Non connectée"}
              </span>
            </div>
            <div className="flex gap-2">
              {!printer ? (
                <Button
                  variant="outline"
                  loading={connectPrinterMut.isPending}
                  onClick={() => connectPrinterMut.mutate()}
                  className="flex-1"
                >
                  <Printer className="size-4" /> Connecter
                </Button>
              ) : (
                <>
                  <Button
                    onClick={() => printMut.mutate()}
                    loading={printMut.isPending}
                    className="flex-1"
                  >
                    <Printer className="size-4" /> Imprimer le ticket
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => disconnectPrinterMut.mutate()}
                  >
                    Déconnecter
                  </Button>
                </>
              )}
            </div>
            <ApiErrorText error={error} />
          </div>
        </Card>
      </Reveal>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Catalogue + panier */}
        <div className="space-y-6">
          <Reveal delay={0.1}>
            <Card title="Catalogue" subtitle="Appuyez sur + pour ajouter au panier." icon={Package}>
              {products.isLoading ? (
                <div className="flex justify-center py-4"><RefreshCw className="size-4 animate-spin" /></div>
              ) : (products.data?.length ?? 0) === 0 ? (
                <EmptyState icon={Package} title="Aucun produit" hint="Créez des produits dans l’administration." />
              ) : (
                <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
                  {products.data?.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 rounded-control bg-surface-inset p-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{formatAmount(productPrice(p))}</p>
                      </div>
                      <Button
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() => addProduct(p)}
                        aria-label={`Ajouter ${p.name}`}
                      >
                        <Plus className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </Reveal>

          <Reveal delay={0.14}>
            <Card title="Panier" icon={Receipt}>
              {cart.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Panier vide.</p>
              ) : (
                <ul className="space-y-2">
                  {cart.map((c) => (
                    <li key={c.productId} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" className="h-7 w-7 p-0" onClick={() => setQty(c.productId, c.qty - 1)} aria-label="diminuer">–</Button>
                        <span className="w-6 text-center text-sm tabular-nums">{c.qty}</span>
                        <Button variant="outline" className="h-7 w-7 p-0" onClick={() => setQty(c.productId, c.qty + 1)} aria-label="augmenter">+</Button>
                      </div>
                      <span className="w-20 text-right text-sm tabular-nums">{formatAmount(c.qty * c.unitPriceMinor)}</span>
                      <Button variant="ghost" className="h-7 w-7 p-0" onClick={() => removeItem(c.productId)} aria-label="supprimer">
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    </li>
                  ))}
                  <li className="flex items-center justify-between border-t border-border pt-2 text-base font-bold">
                    <span>Total</span>
                    <span className="tabular-nums">{formatAmount(totalMinor)}</span>
                  </li>
                </ul>
              )}
            </Card>
          </Reveal>
        </div>

        {/* Client + validation */}
        <div className="space-y-6">
          <Reveal delay={0.18}>
            <Card title="Client" subtitle="Capturez le numéro WhatsApp du client." icon={Phone}>
              <div className="space-y-3">
                <Field label="Recherche client">
                  <Input
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="Nom du client…"
                  />
                </Field>
                {customerSearch && (
                  <ul className="max-h-40 space-y-1 overflow-y-auto">
                    {customers.data
                      ?.filter((c) => c.name.toLowerCase().includes(customerSearch.toLowerCase()))
                      .slice(0, 8)
                      .map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => chooseCustomer(c)}
                            className="flex w-full items-center justify-between rounded-control bg-surface-inset p-2 text-left transition-colors hover:bg-surface"
                          >
                            <span className="text-sm font-semibold">{c.name}</span>
                            <span className="text-xs text-muted-foreground">{c.phone ?? "sans WhatsApp"}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
                <Field label="Nom du client">
                  <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Ex. Amélie Kafula" />
                </Field>
                <Field label="Numéro WhatsApp" hint="Récupéré automatiquement à la vente.">
                  <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="+243 978 508 099" />
                </Field>
                {customerId &&
                customers.data?.find((c) => c.id === customerId)?.creditMinor ? (
                  <Badge tone="warning">
                    Crédit client : {formatAmount(Number(customers.data.find((c) => c.id === customerId)?.creditMinor))}
                  </Badge>
                ) : null}
              </div>
            </Card>
          </Reveal>

          <Reveal delay={0.22}>
            <Card title="Valider la vente" icon={Send}>
              <div className="space-y-3">
                <ApiErrorText error={saveSaleMut.error ? String(saveSaleMut.error) : ""} />
                <Button
                  className="w-full"
                  loading={saveSaleMut.isPending}
                  disabled={cart.length === 0 || !branchId || !customerName}
                  onClick={() => saveSaleMut.mutate()}
                >
                  <Check className="size-4" /> Enregistrer la vente
                </Button>
              </div>
            </Card>
          </Reveal>

          {branchId && (
            <Reveal delay={0.26}>
              <Card title="Ventes récentes" icon={Receipt}>
                {sales.isLoading ? (
                  <div className="flex justify-center py-4"><RefreshCw className="size-4 animate-spin" /></div>
                ) : (sales.data?.length ?? 0) === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">Aucune vente pour cette succursale.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {sales.data?.map((s) => (
                      <li key={s.id} className="flex items-center justify-between py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{s.sellerName ?? "Vendeur"}</p>
                          <p className="text-xs text-muted-foreground">{new Date(s.createdAt).toLocaleString("fr-FR")}</p>
                        </div>
                        <span className="text-sm font-bold tabular-nums">{formatAmount(Number(s.totalMinor))}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Reveal>
          )}
        </div>
      </div>
    </div>
  );
}

