import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

/**
 * Minimal UI kit for the VANNY MANAGER PRO shell (Module A).
 * White-dominant, electric-blue primary, red reserved for destructive
 * actions. Mobile-first: everything stacks, touch targets ≥ 44px.
 */

type ButtonVariant = "primary" | "outline" | "danger" | "ghost";

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
    primary: "bg-primary text-white hover:bg-primary-hover",
    outline:
      "border border-border bg-surface-raised text-foreground hover:bg-surface",
    danger: "bg-accent text-white hover:opacity-90",
    ghost: "text-primary hover:bg-primary-soft",
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
      className={`min-h-11 w-full rounded-control border border-border bg-surface-raised px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary-soft ${className}`}
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
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint ? (
        <span className="block text-xs text-muted-foreground">{hint}</span>
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
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-surface-raised p-4 shadow-sm sm:p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
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
  tone?: "neutral" | "primary" | "danger";
}) {
  const tones = {
    neutral: "bg-surface text-muted-foreground",
    primary: "bg-primary-soft text-primary",
    danger: "bg-accent-soft text-accent",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
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
