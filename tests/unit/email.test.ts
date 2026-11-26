import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deliverMail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  takeCapturedMails,
  type OutboundMail,
} from "../../src/server/email";

const baseMail: OutboundMail = {
  to: "alice@example.cd",
  subject: "Sujet de test",
  text: "corps texte",
  html: "<p>corps html</p>",
  url: "http://localhost:3000/verify?token=tok123",
  token: "tok123",
};

const ENV_KEYS = ["MAIL_TRANSPORT", "RESEND_API_KEY", "RESEND_FROM", "NODE_ENV"] as const;
const savedEnv: Record<string, string | undefined> = {};

function setEnvVars(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  takeCapturedMails(); // drain
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  setEnvVars({ MAIL_TRANSPORT: undefined, RESEND_API_KEY: undefined, RESEND_FROM: undefined });
  fetchMock = vi.fn(async () => {
    throw new Error("fetch should not be called in this test");
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  const mutableEnv = process.env as unknown as Record<string, string | undefined>;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete mutableEnv[k];
    else mutableEnv[k] = savedEnv[k];
  }
  takeCapturedMails();
});

function oneMail(): OutboundMail {
  const mails = takeCapturedMails();
  if (mails.length !== 1) {
    throw new Error(`expected exactly 1 captured mail, got ${mails.length}`);
  }
  const m = mails[0];
  if (!m) throw new Error("captured mail is undefined");
  return m;
}

describe("deliverMail — transport dispatch", () => {
  it("capture: stores in outbox, no network", async () => {
    process.env.MAIL_TRANSPORT = "capture";
    await deliverMail(baseMail);
    const m = oneMail();
    expect(m.to).toBe(baseMail.to);
    expect(m.url).toBe(baseMail.url);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("default (unset) is none: no network, records in outbox (non-prod) for the dev link", async () => {
    // NODE_ENV is "test" here (non-production) → recorded for the dev link.
    await deliverMail(baseMail);
    expect(takeCapturedMails()).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("none in production: still no network, and does NOT record (no mailbox, no dev link)", async () => {
    process.env.MAIL_TRANSPORT = "none";
    (process.env as unknown as Record<string, string | undefined>).NODE_ENV =
      "production";
    await deliverMail(baseMail);
    expect(takeCapturedMails()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("removed 'log' transport is rejected", async () => {
    process.env.MAIL_TRANSPORT = "log";
    await expect(deliverMail(baseMail)).rejects.toThrow(/Unknown MAIL_TRANSPORT/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resend: POSTs to Resend with auth, from, and full body", async () => {
    process.env.MAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "re_secret";
    process.env.RESEND_FROM = "Vanny <no-reply@vanny.cd>";
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ id: "abc" }), { status: 202 }),
    );
    await deliverMail(baseMail);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0];
    if (!callArgs) throw new Error("expected one fetch call");
    const [url, init] = callArgs as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_secret");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe("Vanny <no-reply@vanny.cd>");
    expect(body.to).toBe(baseMail.to);
    expect(body.subject).toBe(baseMail.subject);
    expect(body.html).toBe(baseMail.html);
    expect(body.text).toBe(baseMail.text);
  });

  it("resend: missing RESEND_API_KEY throws before any network call", async () => {
    process.env.MAIL_TRANSPORT = "resend";
    process.env.RESEND_FROM = "Vanny <x@y.z>";
    await expect(deliverMail(baseMail)).rejects.toThrow(/RESEND_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resend: missing RESEND_FROM throws before any network call", async () => {
    process.env.MAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "re_secret";
    await expect(deliverMail(baseMail)).rejects.toThrow(/RESEND_FROM/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resend: non-2xx response throws with provider detail", async () => {
    process.env.MAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "re_secret";
    process.env.RESEND_FROM = "Vanny <x@y.z>";
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ name: "invalid_api_key", message: "bad key" }), {
          status: 401,
        }),
    );
    await expect(deliverMail(baseMail)).rejects.toThrow(/Resend 401/);
  });

  it("resend: network failure surfaces as a safe error", async () => {
    process.env.MAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "re_secret";
    process.env.RESEND_FROM = "Vanny <x@y.z>";
    fetchMock.mockImplementation(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(deliverMail(baseMail)).rejects.toThrow(/network/);
  });

  it("smtp: throws with guidance to use resend", async () => {
    process.env.MAIL_TRANSPORT = "smtp";
    await expect(deliverMail(baseMail)).rejects.toThrow(/smtp is not supported/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unknown transport: throws", async () => {
    process.env.MAIL_TRANSPORT = "carrier-pigeon";
    await expect(deliverMail(baseMail)).rejects.toThrow(/Unknown MAIL_TRANSPORT/);
  });
});

describe("Better Auth hooks", () => {
  it("sendVerificationEmail builds French content and delivers", async () => {
    process.env.MAIL_TRANSPORT = "capture";
    await sendVerificationEmail({
      user: { name: "Alice", email: "alice@example.cd" },
      url: "http://localhost:3000/api/auth/verify-email?token=signed",
      token: "signed",
    });
    const m = oneMail();
    expect(m.to).toBe("alice@example.cd");
    expect(m.subject).toMatch(/Confirmez votre adresse email/);
    expect(m.text).toContain("Alice");
    expect(m.text).toContain("http://localhost:3000/api/auth/verify-email?token=signed");
    expect(m.html).toContain("Confirmer mon adresse");
    expect(m.html).toContain("token=signed");
  });

  it("sendPasswordResetEmail builds French content and delivers", async () => {
    process.env.MAIL_TRANSPORT = "capture";
    await sendPasswordResetEmail({
      user: { name: "Bob", email: "bob@example.cd" },
      url: "http://localhost:3000/reset?token=zzz",
    });
    const m = oneMail();
    expect(m.to).toBe("bob@example.cd");
    expect(m.subject).toMatch(/mot de passe/);
    expect(m.text).toContain("Bob");
    expect(m.html).toContain("Réinitialiser mon mot de passe");
    expect(m.html).toContain("token=zzz");
  });

  it("escapes an untrusted name in HTML (XSS guard)", async () => {
    process.env.MAIL_TRANSPORT = "capture";
    await sendVerificationEmail({
      user: { name: '<img src=x onerror=alert(1)>', email: "x@example.cd" },
      url: "http://localhost/verify?token=t",
      token: "t",
    });
    const m = oneMail();
    expect(m.html).not.toContain("<img src=x onerror=alert(1)>");
    expect(m.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
