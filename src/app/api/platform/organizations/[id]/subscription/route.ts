import { handleApi, readJson } from "@/server/http";
import { updateSubscription } from "@/server/platform";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/platform/organizations/[id]/subscription — update an org's
 * subscription (plan/status/seats/amount). Creates the subscription if none
 * exists. Every change is recorded in the append-only `billing_events`
 * ledger, atomically with the update. Operator-gated.
 */
export async function POST(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const handler = handleApi(async (r) =>
    updateSubscription(r.headers, id, await readJson(r)),
  );
  return handler(req);
}
