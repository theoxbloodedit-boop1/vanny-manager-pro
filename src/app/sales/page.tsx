"use client";

import { useState, useEffect, useCallback } from "react";
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
  CircleDollarSign,
  CloudOff,
  CloudCheck,
  MessageSquare,
  FileText,
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
import { buildInvoicePdf, shareInvoicePdf, type InvoiceData } from "@/lib/invoice";

interface Branch {
  id: string;
  name: string;
}
interface Product {
  id: string;
  name: string;
  categoryName?: string | null;
  priceUsdMinor?: number | null;
  priceCdfMinor?: number | null;
  totalStock?: number | null;
  imageUrl?: string | null;
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

type Currency = "USD" | "CDF";
const CURRENCIES: Currency[] = ["USD", "CDF"];

interface PendingSale {
  branchId: string;
  currency: Currency;
  paymentMethod: string;
  customerId?: string | undefined;
  customerName: string;
  customerPhone?: string | undefined;
  items: SaleItem[];
}

/** Queue hors-ligne : ventes enregistrées sans réseau, synchronisées au rebond. */
const QUEUE_KEY = "vanny:sales-queue:v1";

function readQueue(): PendingSale[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(QUEUE_KEY) ?? "[]") as PendingSale[];
  } catch {
    return [];
  }
}

function writeQueue(items: PendingSale[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

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
  const [currency, setCurrency] = useState<Currency>("CDF");
  const [online, setOnline] = useState<boolean>(
    () => (typeof navigator === "undefined" ? true : navigator.onLine),
  );
  const [pendingCount, setPendingCount] = useState<number>(
    () => (typeof window === "undefined" ? 0 : readQueue().length),
  );
  const [lastInvoice, setLastInvoice] = useState<{ data: InvoiceData; pdf: Blob } | null>(null);
  const [sendingInvoice, setSendingInvoice] = useState(false);

  const formatAmount = (minor: number) =>
    new Intl.NumberFormat("fr-FR").format(minor) + " " + currency;

  // Synchronise la queue hors-ligne au rebond de la connexion (dans un callback
  // d'evenement, pas dans le corps de l'effect, pour eviter les renders en cascade).
  const flushQueue = useCallback(async () => {
    const queue = readQueue();
    if (queue.length === 0) return;
    setPendingCount(queue.length);
    for (const sale of queue) {
      try {
        await postJson("/api/sales", sale);
        writeQueue(readQueue().filter((x) => x !== sale));
      } catch {
        break;
      }
    }
    setPendingCount(readQueue().length);
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void flushQueue();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [flushQueue]);

  const flushQueueMut = useMutation({
    mutationFn: async () => flushQueue(),
  });

  const me = useQuery<{ user?: { name?: string } }>({
    queryKey: ["me"],
    queryFn: () => getJson<{ user?: { name?: string } }>("/api/me"),
  });
  const sellerName = me.data?.user?.name ?? "Vendeur";
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

  // Prix dans la devise de la caisse. USD et CDF sont strictement separes
  // (ADR-0005) : on ne convertit jamais. Si le produit n'a pas de prix dans
  // la devise choisie, il est invendable dans cette devise.
  const productPrice = (p: Product): number | null =>
    currency === "USD" ? p.priceUsdMinor ?? null : p.priceCdfMinor ?? null;

  const hasPriceInCurrency = (p: Product): boolean => productPrice(p) !== null;

  const addProduct = (p: Product) => {
    const price = productPrice(p);
    if (price === null) return; // pas de prix dans la devise de la caisse
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
      const payload: PendingSale = {
        branchId,
        currency,
        paymentMethod: "cash",
        customerId: customerId ?? undefined,
        customerName,
        customerPhone: customerPhone || undefined,
        items: cart,
      };
      // Hors-ligne : la vente est enregistrée en attente et synchronisée au rebond.
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        writeQueue([...readQueue(), payload]);
        setPendingCount(readQueue().length);
        return { queued: true };
      }
      try {
        return await postJson("/api/sales", payload);
      } catch (e) {
        // Erreur réseau (TypeError) : on met en attente pour synchroniser plus tard.
        if (e instanceof TypeError) {
          writeQueue([...readQueue(), payload]);
          setPendingCount(readQueue().length);
          return { queued: true };
        }
        throw e;
      }
    },
    onSuccess: async () => {
      const sold = cart;
      const soldCustomer = customerName;
      const soldCustomerPhone = customerPhone;
      setCart([]);
      setCustomerName("");
      setCustomerPhone("");
      setCustomerId(null);
      setError("");
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      // Génère automatiquement la facture PDF de la vente.
      const branchName = branches.data?.find((b) => b.id === branchId)?.name ?? "";
      const invoiceData: InvoiceData = {
        orgName: "VANNY",
        branchName,
        customerName: soldCustomer,
        customerPhone: soldCustomerPhone,
        sellerName,
        currency,
        paymentMethod: "cash",
        lines: sold.map((c) => ({
          name: c.name,
          qty: c.qty,
          unitPriceMinor: c.unitPriceMinor,
        })),
        totalMinor: sold.reduce((sum, c) => sum + c.qty * c.unitPriceMinor, 0),
        dateLabel: new Date().toLocaleString("fr-FR"),
      };
      const pdf = buildInvoicePdf(invoiceData);
      setLastInvoice({ data: invoiceData, pdf });
      // Imprimante : ticket automatique si connectée.
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

      {/* Caisse : devise + statut hors-ligne */}
      <Reveal delay={0.04}>
        <Card title="Caisse" icon={CircleDollarSign}
          subtitle="USD et CDF gérés séparément — jamais convertis silencieusement.">
          <div className="space-y-3">
            <Field label="Devise de la caisse">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c === "CDF" ? "CDF — franc congolais" : "USD — dollar américain"}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-center justify-between rounded-control bg-surface-inset p-2">
              <div className="flex items-center gap-2">
                {online ? (
                  <CloudCheck className="size-4 text-success" />
                ) : (
                  <CloudOff className="size-4 text-warning" />
                )}
                <span className="text-sm font-semibold">
                  {online
                    ? "En ligne — synchronisation automatique"
                    : "Hors-ligne — ventes enregistrées en attente"}
                </span>
              </div>
              {pendingCount > 0 ? (
                <Button
                  variant="outline"
                  className="h-8 px-3 text-xs"
                  onClick={() => flushQueueMut.mutate()}
                  disabled={!online || flushQueueMut.isPending}
                >
                  <RefreshCw className={`size-4 ${flushQueueMut.isPending ? "animate-spin" : ""}`} />
                  Synchroniser ({pendingCount})
                </Button>
              ) : null}
            </div>
          </div>
        </Card>
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
                      <div className="flex min-w-0 items-center gap-2">
                        {p.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imageUrl} alt="" className="size-9 shrink-0 rounded-control object-cover" />
                        ) : (
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary">
                            <Package className="size-4" />
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{p.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.categoryName ? `${p.categoryName} · ` : ""}
                            {hasPriceInCurrency(p) ? formatAmount(productPrice(p)!) : "prix n/a en " + currency}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        className="h-8 w-8 p-0 disabled:opacity-40"
                        disabled={!hasPriceInCurrency(p)}
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
                      {(() => {
                        const prod = products.data?.find((x) => x.id === c.productId);
                        return prod?.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={prod.imageUrl} alt="" className="size-9 shrink-0 rounded-control object-cover" />
                        ) : (
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary">
                            <Package className="size-4" />
                          </span>
                        );
                      })()}
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
                {lastInvoice && (
                  <div className="space-y-2 rounded-control bg-success-soft p-3">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-success">
                      <FileText className="size-4" /> Facture PDF générée
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        className="flex-1"
                        loading={sendingInvoice}
                        onClick={async () => {
                          setSendingInvoice(true);
                          try {
                            await shareInvoicePdf(
                              lastInvoice.pdf,
                              lastInvoice.data.customerPhone,
                              `Facture VANNY — ${lastInvoice.data.customerName} — total ${lastInvoice.data.totalMinor} ${lastInvoice.data.currency}`,
                            );
                          } finally {
                            setSendingInvoice(false);
                          }
                        }}
                      >
                        <MessageSquare className="size-4" /> Envoyer par WhatsApp
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          const url = URL.createObjectURL(lastInvoice.pdf);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = "facture.pdf";
                          a.click();
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                        }}
                      >
                        <FileText className="size-4" /> Télécharger
                      </Button>
                    </div>
                  </div>
                )}
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

