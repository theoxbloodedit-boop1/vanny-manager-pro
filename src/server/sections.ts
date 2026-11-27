/**
 * Sections manquantes du tableau de bord propriétaire :
 * dépenses, fournisseurs, appareils (synchronisation), journal d'activité.
 * Toutes les fonctions sont tenant-scoped via withTenantDb (ADR-0001) et
 * gated par authorize() (ADR-0001 binding rule 1).
 */

import { and, desc, eq } from "drizzle-orm";
import { requireActiveOrg } from "./members";
import { authorize } from "./rbac/authorize";
import { withTenantDb } from "../db/tenant";
import { expenses, suppliers, devices, activityLog } from "@/db/schema/sections";
import { z } from "zod";

/* ------------------------------- DÉPENSES ------------------------------ */

export async function listExpenses(headers: Headers) {
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "expenses.view" });
    return db.select().from(expenses).orderBy(desc(expenses.createdAt));
  });
}

const expenseBody = z.object({
  branchId: z.string().uuid().optional(),
  category: z.string().min(1).max(60).optional(),
  label: z.string().min(1).max(200),
  amountMinor: z.number().int().min(0),
  currency: z.enum(["USD", "CDF"]),
  note: z.string().max(500).optional(),
});

export async function createExpense(headers: Headers, raw: unknown) {
  const body = expenseBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "expenses.create" });
    const [row] = await db
      .insert(expenses)
      .values({
        orgId,
        branchId: body.branchId ?? null,
        category: body.category ?? "autres",
        label: body.label,
        amountMinor: body.amountMinor,
        currency: body.currency,
        note: body.note ?? null,
        createdBy: userId,
      })
      .returning();
    return row;
  });
}

/* ----------------------------- FOURNISSEURS ----------------------------- */

export async function listSuppliers(headers: Headers) {
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "suppliers.view" });
    return db.select().from(suppliers).orderBy(desc(suppliers.createdAt));
  });
}

const supplierBody = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().max(32).optional(),
  note: z.string().max(500).optional(),
});

export async function createSupplier(headers: Headers, raw: unknown) {
  const body = supplierBody.parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "suppliers.manage" });
    const [row] = await db
      .insert(suppliers)
      .values({
        orgId,
        name: body.name,
        phone: body.phone ?? null,
        note: body.note ?? null,
        createdBy: userId,
      })
      .returning();
    return row;
  });
}

/* ------------------------------- APPAREILS ------------------------------ */

export async function listDevices(headers: Headers) {
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "audit.view" });
    return db.select().from(devices).orderBy(desc(devices.lastSeenAt));
  });
}

/** Synchronise l'état d'un appareil (last_seen). Utilisé par le client sync. */
export async function touchDevice(
  headers: Headers,
  raw: unknown,
): Promise<{ deviceId: string; lastSeenAt: string }> {
  const body = z.object({ deviceId: z.string().uuid() }).parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "sales.create" });
    const [row] = await db
      .update(devices)
      .set({ lastSeenAt: new Date() })
      .where(and(eq(devices.id, body.deviceId), eq(devices.orgId, orgId)))
      .returning({ id: devices.id, lastSeenAt: devices.lastSeenAt });
    if (!row) throw new Error("Appareil introuvable.");
    return { deviceId: row.id, lastSeenAt: row.lastSeenAt.toISOString() };
  });
}

/** Révoque un appareil (bloque la synchronisation, ADR-0007). */
export async function revokeDevice(headers: Headers, raw: unknown) {
  const body = z.object({ deviceId: z.string().uuid() }).parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "audit.view" });
    const [row] = await db
      .update(devices)
      .set({ revokedAt: new Date() })
      .where(and(eq(devices.id, body.deviceId), eq(devices.orgId, orgId)))
      .returning();
    if (!row) throw new Error("Appareil introuvable.");
    return row;
  });
}

/** Enregistre un appareil (le vendeur/caissier autorise son appareil). */
export async function registerDevice(headers: Headers, raw: unknown) {
  const body = z
    .object({
      label: z.string().min(1).max(120),
      platform: z.string().min(1).max(40).optional(),
      branchId: z.string().uuid().optional(),
    })
    .parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "sales.create" });
    const [row] = await db
      .insert(devices)
      .values({
        orgId,
        label: body.label,
        platform: body.platform ?? "web",
        branchId: body.branchId ?? null,
        memberId: userId,
      })
      .returning();
    return row;
  });
}

/* -------------------------- JOURNAL D'ACTIVITÉ -------------------------- */

/** Écrit une ligne dans le journal d'activité (append-only). */
export async function logActivity(
  headers: Headers,
  raw: unknown,
): Promise<{ id: string }> {
  const body = z
    .object({
      action: z.string().min(1).max(120),
      detail: z.record(z.string(), z.unknown()).optional(),
    })
    .parse(raw);
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    const [row] = await db
      .insert(activityLog)
      .values({
        orgId,
        actorId: userId,
        action: body.action,
        detail: body.detail ?? null,
      })
      .returning({ id: activityLog.id });
    return { id: row!.id };
  });
}

export async function listActivity(headers: Headers) {
  const { userId, orgId } = await requireActiveOrg(headers);
  return withTenantDb(orgId, async (db) => {
    await authorize(db, { userId, permission: "audit.view" });
    return db
      .select()
      .from(activityLog)
      .orderBy(desc(activityLog.createdAt))
      .limit(100);
  });
}
