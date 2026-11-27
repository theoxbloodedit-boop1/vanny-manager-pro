import { handleApi, readJson } from "@/server/http";
import {
  listDevices,
  registerDevice,
  revokeDevice,
  touchDevice,
} from "@/server/sections";

/** GET /api/devices — registre des appareils du tenant. */
export const GET = handleApi(async (req) => listDevices(req.headers));

/** POST /api/devices — enregistrer/autoriser un appareil de sync. */
export const POST = handleApi(async (req) =>
  registerDevice(req.headers, await readJson(req)),
);

/** PATCH /api/devices — touch (sync) ou révoquer un appareil. */
export const PATCH = handleApi(async (req) => {
  const body = (await readJson(req)) as { deviceId: string; action?: string };
  const method = req.method;
  if (method === "PATCH" && body.action === "revoke") {
    return revokeDevice(req.headers, { deviceId: body.deviceId });
  }
  return touchDevice(req.headers, { deviceId: body.deviceId });
});
