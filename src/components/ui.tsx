import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

/**
 * UI kit — VANNY MANAGER PRO (design system v2, famille "Blanc Signal").
 * Blanche dominée, bleu confiné, rouge réservé au destructif.
 * Mobile-first : tout s'empile, cibles tactiles ≥ 44px.
 */

type ButtonVariant = "primary" | "outline" | "danger" | "ghost" | "soft";

export function Button({
  variant = "primary",
  loading = false,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
}) {
  const base =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const variants: Record<ButtonVariant, string> = {
    primary:
      "bg-primary text-white shadow-card hover:bg-primary-hover active:bg-primary-active",
    outline:
      "border border-border-strong bg-surface-raised text-foreground hover:bg-surface",
    danger: "bg-accent text-white hover:opacity-90",
    ghost: "text-primary hover:bg-primary-soft",
    soft: "bg-primary-soft text-primary hover:bg-primary/15",
  };
  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export function Input({
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`min-h-11 w-full rounded-control border border-border bg-surface-raised px-3 text-sm text-foreground outline-none placeholder:text-faint-foreground focus:border-primary focus:ring-2 focus:ring-primary-soft ${className}`}
      {...rest}
    />
  );
}

export function Select({
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`min-h-11 w-full appearance-none rounded-control border border-border bg-surface-raised px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      {children}
      {hint ? (
        <span className="block text-xs leading-5 text-muted-foreground">{hint}</span>
      ) : null}
      {error ? (
        <span className="block text-xs font-medium text-accent">{error}</span>
      ) : null}
    </label>
  );
}

export function Card({
  title,
  subtitle,
  icon: Icon,
  children,
  actions,
  className = "",
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-card border border-border bg-surface-raised p-4 shadow-card sm:p-5 ${className}`}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-control bg-primary-faint text-primary">
              <Icon className="size-4.5" aria-hidden />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="font-semibold tracking-tight text-foreground">{title}</h2>
            {subtitle ? (
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "primary" | "danger" | "success" | "warning";
}) {
  const tones = {
    neutral: "bg-surface-inset text-muted-foreground",
    primary: "bg-primary-soft text-primary",
    danger: "bg-accent-soft text-accent",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function ApiErrorText({ error }: { error?: string | undefined }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="rounded-control bg-accent-soft px-3 py-2 text-sm text-accent"
    >
      {error}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Marque                                                              */
/* ------------------------------------------------------------------ */

export function LogoMark({ className = "size-10" }: { className?: string }) {
  return (
    <span
      className={`flex items-center justify-center rounded-xl bg-primary shadow-card ${className}`}
      aria-hidden
    >
      <svg
        viewBox="0 0 40 40"
        className="h-[1.05em] w-[1.05em]"
        fill="none"
        fillRule="evenodd"
      >
        {/* V dynamique */}
        <path
          d="M10.5 14 L20 27.5 L29.5 14"
          stroke="#ffffff"
          strokeWidth="3.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Flèche de croissance à la pointe */}
        <path
          d="M29.5 14 L33.5 10.5 M29.5 14 L33.5 17.5"
          stroke="#ffffff"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.9"
        />
      </svg>
    </span>
  );
}

export function Logo({
  to = "/",
  compact = false,
}: {
  to?: string;
  compact?: boolean;
}) {
  return (
    <Link href={to} className="flex items-center gap-2.5">
      <LogoMark className={compact ? "size-8" : "size-10"} />
      <span className="flex flex-col leading-none">
        <span
          className={`font-extrabold tracking-tight text-foreground ${compact ? "text-sm" : "text-base"}`}
        >
          VANNY
        </span>
        {!compact ? (
          <span className="mt-0.5 text-[0.65rem] font-bold tracking-[0.18em] text-muted-foreground">
            MANAGER PRO
          </span>
        ) : null}
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Composants d'état                                                   */
/* ------------------------------------------------------------------ */

export function Avatar({ name, className = "size-9" }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-hover font-bold text-white shadow-card ring-1 ring-white/20 ${className}`}
    >
      <span className="leading-none drop-shadow-sm">{initials || "?"}</span>
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-control bg-surface px-4 py-8 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-surface-inset text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {hint ? <p className="max-w-xs text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  icon: Icon,
  tone = "primary",
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: "primary" | "neutral" | "warning";
}) {
  const tones = {
    primary: "bg-primary-soft text-primary",
    neutral: "bg-surface-inset text-muted-foreground",
    warning: "bg-warning-soft text-warning",
  } as const;
  return (
    <div className="flex items-center gap-3 rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-control ${tones[tone]}`}>
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-xl font-extrabold leading-6 tracking-tight tabular-nums">{value}</p>
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`grid gap-1 rounded-control bg-surface-inset p-1 ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-9 rounded-[0.55rem] px-3 text-sm font-semibold transition-colors ${
            value === o.value
              ? "bg-surface-raised text-foreground shadow-card"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
