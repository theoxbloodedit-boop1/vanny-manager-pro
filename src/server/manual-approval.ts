/**
 * MANUAL APPROVAL (ADR-0014) — service layer.
 *
 * A manual approval marks a user as `manually_approved` so they can satisfy
 * the invitation-acceptance verification gate WITHOUT a verified email. It is
 * DISTINCT from `emailVerified` (never written here) and grants NO organization
 * access by itself — it only lets the user accept the invitation they hold.
 *
 * `applyManualApproval` performs the status update and the append-only audit
 * insert in a SINGLE transaction (atomic). The caller must supply a VERIFIED
 * operator identity (from an authenticated execution context — see
 * scripts/manual-approval.mts), never a freely-typed argument.
 */
import { eq } from "drizzle-orm";
import { getAuthDb } from "../auth/db";
import { manualApprovals, users } from "../db/schema/auth";
import { uuidv7 } from "../lib/uuid";

export type ManualApprovalAction = "approve" | "revoke";

export interface ManualApprovalInput {
  /** Verified operator identifier (subject of the verified operator token). */
  operatorId: string;
  /** Target user, by email (operation data — not an identity proof). */
  userEmail: string;
  action: ManualApprovalAction;
  /** Mandatory reason for the operation. */
  reason: string;
}

export interface ManualApprovalResult {
  userId: string;
  userEmail: string;
  /** The user's manual-approval state after the operation. */
  manuallyApproved: boolean;
  /** Correlates the status change with the audit row. */
  operationId: string;
  /** UTC timestamp of the operation. */
  at: Date;
}

export class ManualApprovalError extends Error {}

/**
 * Apply an approval or revocation in a single transaction:
 * update `user.manually_approved` + insert an append-only `manual_approvals`
 * row. `emailVerified` is never touched. Fails closed (no partial write).
 */
export async function applyManualApproval(
  input: ManualApprovalInput,
): Promise<ManualApprovalResult> {
  if (!input.operatorId || input.operatorId.length === 0) {
    throw new ManualApprovalError("operatorId is required");
  }
  const reason = input.reason?.trim();
  if (!reason) {
    throw new ManualApprovalError("a reason is required for manual approval");
  }
  if (input.action !== "approve" && input.action !== "revoke") {
    throw new ManualApprovalError("action must be 'approve' or 'revoke'");
  }

  const db = getAuthDb();
  const operationId = uuidv7();
  const at = new Date();

  const result = await db.transaction(async (tx) => {
    const found = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, input.userEmail))
      .limit(1);
    const user = found[0];
    if (!user) {
      throw new ManualApprovalError(`user not found: ${input.userEmail}`);
    }
    const newValue = input.action === "approve";
    // Update ONLY the manual-approval flag — never emailVerified.
    await tx
      .update(users)
      .set({ manuallyApproved: newValue })
      .where(eq(users.id, user.id));
    // Append-only audit row (same transaction).
    await tx.insert(manualApprovals).values({
      id: uuidv7(),
      userId: user.id,
      operatorId: input.operatorId,
      action: input.action,
      reason,
      operationId,
      createdAt: at,
    });
    return { userId: user.id, userEmail: user.email, manuallyApproved: newValue };
  });

  return { ...result, operationId, at };
}

/**
 * Current manual-approval state for a user — read by the invitation-acceptance
 * gate. Reads the platform `user` table (owner role), RLS does not apply.
 */
export async function isManuallyApproved(userId: string): Promise<boolean> {
  const db = getAuthDb();
  const rows = await db
    .select({ v: users.manuallyApproved })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  return row ? row.v : false;
}
