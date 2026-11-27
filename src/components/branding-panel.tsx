"use client";

/**
 * ADR-0020 — BRANDING panel: logo upload, brand name, accent color.
 *
 * Lets the owner personalise the tenant's space beyond the static theme.
 * Logo is read as a data URL (base64) via FileReader, validated client-side
 * (type + size) then server-side (magic bytes + size cap, fail-closed).
 * Accent color is a #RRGGBB picker. All changes PATCH /api/org/branding.
 */
import { useRef, useState } from "react";
import { ImagePlus, Trash2, Palette } from "lucide-react";
import {
  ApiErrorText,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Spinner,
} from "@/components/ui";
import { getJson, patchJson } from "@/lib/http-client";

interface Branding {
  brandName: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  themeId: string | null;
}

const MAX_LOGO_MB = 1.5;
const ACCENT_PRESETS = [
  "#0b5cff",
  "#e5252c",
  "#12833b",
  "#b45309",
  "#7c3aed",
  "#0e7490",
  "#000000",
  "#6b7280",
];

export function BrandingPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [brandName, setBrandName] = useState("");
  const [logoData, setLogoData] = useState<string | null>(null);
  const [color, setColor] = useState("#0b5cff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function load() {
    try {
      const b = await getJson<Branding>("/api/org/branding");
      setBranding(b);
      setBrandName(b.brandName ?? "");
      setLogoData(b.logoUrl);
      setColor(b.brandColor ?? "#0b5cff");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
    }
  }

  // Load once on mount.
  if (branding === null) {
    load();
    return (
      <Card title="Identité de marque" icon={Palette}>
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      </Card>
    );
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_LOGO_MB * 1024 * 1024) {
      setError(`Logo trop lourd (max ${MAX_LOGO_MB} MB).`);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Le logo doit être une image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogoData(reader.result as string);
      setError(undefined);
    };
    reader.readAsDataURL(file);
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const b = await patchJson<Branding>("/api/org/branding", {
        brandName: brandName.trim() || null,
        logoUrl: logoData,
        brandColor: color,
      });
      setBranding(b);
      setBrandName(b.brandName ?? "");
      setLogoData(b.logoUrl);
      setColor(b.brandColor ?? "#0b5cff");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sauvegarde impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Identité de marque"
      subtitle="Personnalisez l'espace de votre boutique : logo, nom, couleur."
      icon={Palette}
    >
      <div className="space-y-5">
        {/* Logo + name row */}
        <div className="flex items-start gap-4">
          <div className="flex flex-col items-center gap-2">
            <div className="flex size-20 items-center justify-center overflow-hidden rounded-card border border-border bg-surface-raised">
              {logoData ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoData} alt="Logo" className="size-full object-contain" />
              ) : (
                <span className="text-2xl font-extrabold text-primary">
                  {(brandName || "V").slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={onFile}
              className="hidden"
            />
            <Button variant="outline" className="min-h-10 px-3 text-xs" onClick={() => fileRef.current?.click()}>
              <ImagePlus className="size-3.5" aria-hidden />
              Changer
            </Button>
            {logoData && (
              <Button
                variant="ghost"
                className="min-h-10 px-3 text-xs text-accent"
                onClick={() => setLogoData(null)}
              >
                <Trash2 className="size-3.5" aria-hidden />
                Supprimer
              </Button>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <Field label="Nom de marque" hint="Affiché dans l'en-tête et la connexion. Vide = nom de l'organisation.">
              <Input
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="Ex : Ma Boutique"
              />
            </Field>
          </div>
        </div>

        {/* Accent color */}
        <Field label="Couleur d'accent" hint="Couleur principale de votre espace (héritée du thème si non définie).">
          <div className="flex flex-wrap items-center gap-2">
            {ACCENT_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Couleur ${c}`}
                onClick={() => setColor(c)}
                className={`size-9 rounded-full border-2 transition-transform hover:scale-110 ${
                  color.toLowerCase() === c.toLowerCase()
                    ? "border-foreground ring-2 ring-primary-soft"
                    : "border-border"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
            <div className="flex items-center gap-1.5">
              <Input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-28"
                placeholder="#0b5cff"
              />
              <span
                className="size-9 rounded-full border-2 border-border"
                style={{ backgroundColor: color }}
                aria-hidden
              />
            </div>
          </div>
        </Field>

        <div className="flex items-center gap-2">
          <Badge tone="neutral">
            {branding.brandColor ? `Accent : ${branding.brandColor}` : "Accent : thème"}
          </Badge>
          {branding.themeId && <Badge tone="primary">Thème : {branding.themeId}</Badge>}
        </div>

        <ApiErrorText error={error} />

        <Button loading={busy} onClick={save} className="w-full">
          <Palette className="size-4" aria-hidden />
          Enregistrer l’identité
        </Button>
      </div>
    </Card>
  );
}
