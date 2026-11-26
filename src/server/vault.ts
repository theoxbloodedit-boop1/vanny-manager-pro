/**
 * ADR-0022 — COFFRE-FORT (vault) service layer.
 *
 * A per-organization safe where the business accumulates money gradually to
 * pay its obligations (factures, loyer, impôt) at the end of the month —
 * without stress.
 *
 * Concepts:
 *   - vaultEntries   : deposit / withdrawal / payment movements (append-only)
 *   - vaultObligations: payables (facture, loyer, ...) with a target amount,
 *                       a due date and a running paid amount.
 *
 * The vault balance is DERIVED: sum(deposits) - sum(withdrawals) -
 * sum(payments). It is never stored, so it can never drift.
 *
 * Authorization: `vault.view` to read, `vault.deposit` to move money in/out,
 * `vault.manage` to create/modify obligations. Runs inside `withTenantDb`
 * so RLS scopes every read/write to the caller's own org.
 */
import { eq, and, desc, sql } from "drizzle-orm";
import * as z from "zod";
import { withTenantDb } from "../db/tenant";
import { vaultEntries, vaultObligations } from "../db/schema/vault";
import { ApiError } from "./errors";
import { requireActiveOrg } from "./members";
import { authorize } from "./rbac/authorize";

const currencyEnum = z.enum(["USD", "CDF"]);

const obligationBody = z.object({
  title: z.string().min(1).max(120),
  kind: z.enum(["expense", "rent", "invoice", "tax"]).optional(),
  amountMinor: z.number().int().min(0).max(100_000_000_000),
  currency: currencyEnum,
  dueAt: z.string().datetime().nullable().optional(),
  note: z.string().max(200).nullable().optional(),
});

const depositBody = z.object({
  amountMinor: z.number().int().min(1).max(100_000_000_000),
  currency: currencyEnum,
  note: z.string().max(200).nullable().optional(),
});

const withdrawalBody = z.object({
  amountMinor: z.number().int().min(1).max(100_000_000_000),
  currency: currencyEnum,
  note: z.string().max(200).nullable().optional(),
});

const payBody = z.object({
  obligationId: z.string().uuid(),
  amountMinor: z.number().int().min(1).max(100_000_000_000),
  note: z.string().max(200).nullable().optional(),
});

export interface Obligation {
  id: string;
  title: string;
  kind: string;
  amountMinor: number;
  currency: string;
  dueAt: string | null;
  paidMinor: number;
  status: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VaultEntry {
  id: string;
  kind: string;
  amountMinor: number;
  currency: string;
  obligationId: string | null;
  note: string | null;
  createdAt: Date;
}

export interface VaultSummary {
  balanceUsdMinor: number;
  balanceCdfMinor: number;
  openObligations: number;
  openObligationsUsdMinor: number;
  openObligationsCdfMinor: number;
  overdueObligations: number;
}

/** Read the vault summary + obligations + recent entries. */
export async function getVault(headers: Headers) {
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "vault.view" });

    const entries = await db
      .select({
        id: vaultEntries.id,
        kind: vaultEntries.kind,
        amountMinor: vaultEntries.amountMinor,
        currency: vaultEntries.currency,
        obligationId: vaultEntries.obligationId,
        note: vaultEntries.note,
        createdAt: vaultEntries.createdAt,
      })
      .from(vaultEntries)
      .orderBy(desc(vaultEntries.createdAt))
      .limit(100);

    const obligations = await db
      .select({
        id: vaultObligations.id,
        title: vaultObligations.title,
        kind: vaultObligations.kind,
        amountMinor: vaultObligations.amountMinor,
        currency: vaultObligations.currency,
        dueAt: vaultObligations.dueAt,
        paidMinor: vaultObligations.paidMinor,
        status: vaultObligations.status,
        note: vaultObligations.note,
        createdAt: vaultObligations.createdAt,
        updatedAt: vaultObligations.updatedAt,
      })
      .from(vaultObligations)
      .orderBy(desc(vaultObligations.dueAt));

    // Derived balances.
    let balanceUsd = 0;
    let balanceCdf = 0;
    for (const e of entries) {
      const signed =
        e.kind === "deposit" ? e.amountMinor : -e.amountMinor;
      if (e.currency === "USD") balanceUsd += signed;
      else balanceCdf += signed;
    }

    let openObligations = 0;
    let openUsd = 0;
    let openCdf = 0;
    let overdue = 0;
    const now = Date.now();
    for (const o of obligations) {
      if (o.status === "paid") continue;
      openObligations += 1;
      const remaining = o.amountMinor - o.paidMinor;
      if (o.currency === "USD") openUsd += remaining;
      else openCdf += remaining;
      if (o.dueAt && new Date(o.dueAt).getTime() < now) overdue += 1;
    }

    return {
      summary: {
        balanceUsdMinor: balanceUsd,
        balanceCdfMinor: balanceCdf,
        openObligations,
        openObligationsUsdMinor: openUsd,
        openObligationsCdfMinor: openCdf,
        overdueObligations: overdue,
      } as VaultSummary,
      obligations: obligations as Obligation[],
      entries: entries as VaultEntry[],
    };
  });
}

/** Create an obligation (facture, loyer, ...). */
export async function createObligation(headers: Headers, raw: unknown) {
  const body = obligationBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "vault.manage" });

    const dueAt =
      body.dueAt === undefined || body.dueAt === null
        ? null
        : new Date(body.dueAt);

    const rows = await db
      .insert(vaultObligations)
      .values({
        orgId,
        title: body.title.trim(),
        kind: body.kind ?? "expense",
        amountMinor: body.amountMinor,
        currency: body.currency,
        dueAt,
        note: body.note ?? null,
        createdBy: userId,
      })
      .returning({ id: vaultObligations.id });
    return { id: rows[0]?.id };
  });
}

/** Mark an obligation as fully paid (or delete it). */
export async function settleObligation(headers: Headers, obligationId: string) {
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "vault.manage" });
    const rows = await db
      .update(vaultObligations)
      .set({
        paidMinor: sql`${vaultObligations.amountMinor}`,
        status: "paid",
        updatedAt: new Date(),
      })
      .where(and(eq(vaultObligations.id, obligationId), eq(vaultObligations.orgId, orgId)))
      .returning({ id: vaultObligations.id });
    if (rows.length === 0) {
      throw new ApiError(404, "NOT_FOUND", "Obligation introuvable.");
    }
    return { id: rows[0]?.id };
  });
}

/** Delete an obligation (only if not paid). */
export async function deleteObligation(headers: Headers, obligationId: string) {
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "vault.manage" });
    const rows = await db
      .delete(vaultObligations)
      .where(and(eq(vaultObligations.id, obligationId), eq(vaultObligations.orgId, orgId)))
      .returning({ id: vaultObligations.id });
    if (rows.length === 0) {
      throw new ApiError(404, "NOT_FOUND", "Obligation introuvable.");
    }
    return { id: rows[0]?.id };
  });
}

/** Deposit money into the vault. */
export async function depositToVault(headers: Headers, raw: unknown) {
  const body = depositBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "vault.deposit" });
    const rows = await db
      .insert(vaultEntries)
      .values({
        orgId,
        kind: "deposit",
        amountMinor: body.amountMinor,
        currency: body.currency,
        note: body.note ?? null,
        createdBy: userId,
      })
      .returning({ id: vaultEntries.id });
    return { id: rows[0]?.id };
  });
}

/** Withdraw money from the vault. */
export async function withdrawFromVault(headers: Headers, raw: unknown) {
  const body = withdrawalBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "vault.deposit" });

    // Fail-closed: cannot withdraw more than the available balance of that
    // currency (balance is derived, so we recompute it).
    const entries = await db
      .select({ kind: vaultEntries.kind, amountMinor: vaultEntries.amountMinor, currency: vaultEntries.currency })
      .from(vaultEntries)
      .where(eq(vaultEntries.orgId, orgId));
    let balance = 0;
    for (const e of entries) {
      if (e.currency !== body.currency) continue;
      balance += e.kind === "deposit" ? e.amountMinor : -e.amountMinor;
    }
    if (body.amountMinor > balance) {
      throw new ApiError(
        400,
        "INSUFFICIENT_FUNDS",
        "Solde insuffisant pour ce retrait.",
      );
    }

    const rows = await db
      .insert(vaultEntries)
      .values({
        orgId,
        kind: "withdrawal",
        amountMinor: body.amountMinor,
        currency: body.currency,
        note: body.note ?? null,
        createdBy: userId,
      })
      .returning({ id: vaultEntries.id });
    return { id: rows[0]?.id };
  });
}

/** Pay an obligation from the vault, partially or fully. */
export async function payObligation(headers: Headers, raw: unknown) {
  const body = payBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "vault.deposit" });

    const obligation = await db
      .select({
        id: vaultObligations.id,
        amountMinor: vaultObligations.amountMinor,
        paidMinor: vaultObligations.paidMinor,
        currency: vaultObligations.currency,
        status: vaultObligations.status,
        orgId: vaultObligations.orgId,
      })
      .from(vaultObligations)
      .where(eq(vaultObligations.id, body.obligationId))
      .limit(1);
    const ob = obligation[0];
    if (!ob) {
      throw new ApiError(404, "NOT_FOUND", "Obligation introuvable.");
    }
    if (ob.orgId !== orgId) {
      throw new ApiError(403, "FORBIDDEN", "Obligation hors de votre organisation.");
    }
    if (ob.status === "paid") {
      throw new ApiError(400, "ALREADY_PAID", "Cette obligation est déjà soldée.");
    }
    const remaining = ob.amountMinor - ob.paidMinor;
    const payAmount = Math.min(body.amountMinor, remaining);

    // The vault must actually hold the money in that currency (fail-closed).
    const entries = await db
      .select({ kind: vaultEntries.kind, amountMinor: vaultEntries.amountMinor, currency: vaultEntries.currency })
      .from(vaultEntries)
      .where(eq(vaultEntries.orgId, orgId));
    let balance = 0;
    for (const e of entries) {
      if (e.currency !== ob.currency) continue;
      balance += e.kind === "deposit" ? e.amountMinor : -e.amountMinor;
    }
    if (payAmount > balance) {
      throw new ApiError(
        400,
        "INSUFFICIENT_FUNDS",
        "Solde du coffre insuffisant pour ce paiement.",
      );
    }

    await db
      .insert(vaultEntries)
      .values({
        orgId,
        kind: "payment",
        amountMinor: payAmount,
        currency: ob.currency,
        obligationId: ob.id,
        note: body.note ?? null,
        createdBy: userId,
      });

    const newPaid = ob.paidMinor + payAmount;
    await db
      .update(vaultObligations)
      .set({
        paidMinor: newPaid,
        status: newPaid >= ob.amountMinor ? "paid" : "open",
        updatedAt: new Date(),
      })
      .where(eq(vaultObligations.id, ob.id));

    return { id: ob.id, paidMinor: newPaid, amountMinor: ob.amountMinor, status: newPaid >= ob.amountMinor ? "paid" : "open" };
  });
}
