// POST /api/webhooks/twilio/[tenantId] — inbound SMS from Twilio (c113, the
// two-way half of the SMS channel).
//
// Each firm gets its OWN Twilio number, configured in the Twilio console
// with ITS OWN webhook URL (this path, with that firm's tenantId) — unlike
// the Postmark delivery webhook, there is no shared metadata to recover the
// tenant from, because an inbound text carries none. This also means a
// forged tenantId in the URL can never reach another firm's data: the
// request still has to carry valid Basic-auth credentials (shared across
// firms is fine — only Twilio, server-side, ever sees them) AND then every
// query inside runs in that one tenant's withTenant() scope.
//
// Protected by HTTP Basic auth, same scheme and helper as the Postmark
// webhook: configure Twilio's "A MESSAGE COMES IN" webhook as
//   https://<user>:<password>@<this host>/api/webhooks/twilio/<tenantId>
// with the same values in SMS_WEBHOOK_USER / SMS_WEBHOOK_PASSWORD. Fails
// closed: if either is unset every call is refused.
//
// Always answers with empty TwiML so Twilio doesn't auto-reply or retry an
// outcome this route has already decided is final (including "unmatched" —
// retrying wouldn't change the result). A genuine processing failure (DB
// down, etc.) answers 500 so Twilio retries later.
//
// Database modules are imported lazily so `next build` never needs a
// DATABASE_URL (same pattern as src/app/api/webhooks/postmark/route.ts).

import { checkBasicAuth } from "@/integrations/email/postmarkWebhook";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_TWIML = new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } });

export async function POST(req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!UUID_RE.test(tenantId)) {
    return Response.json({ error: "Unknown webhook path." }, { status: 404 });
  }

  const auth = checkBasicAuth(req.headers.get("authorization"), {
    user: process.env.SMS_WEBHOOK_USER,
    password: process.env.SMS_WEBHOOK_PASSWORD,
  });
  if (auth !== "ok") {
    return Response.json(
      { error: auth === "not_configured" ? "Webhook credentials are not configured on this deployment." : "Unauthorized." },
      { status: 401, headers: { "WWW-Authenticate": 'Basic realm="twilio-sms-webhook"' } }
    );
  }

  let from: string | null;
  let to: string | null;
  let body: string;
  let messageSid: string | null;
  try {
    const form = await req.formData();
    const str = (key: string) => {
      const v = form.get(key);
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };
    from = str("From");
    to = str("To");
    body = str("Body") ?? "";
    messageSid = str("MessageSid");
  } catch {
    return EMPTY_TWIML; // Not a form body Twilio would ever actually send; nothing to do.
  }
  if (!from || !to) return EMPTY_TWIML;

  try {
    const { withTenant } = await import("@/tenancy/withTenant");
    const { handleInboundSms } = await import("@/engines/all-engines/smsChannel/service");
    await withTenant(tenantId, (tx) => handleInboundSms(tx, { tenantId, from, to, body, providerMessageId: messageSid }));
    return EMPTY_TWIML;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "sms_webhook.failed",
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    // 500 so Twilio retries a genuinely failed write later.
    return new Response("<Response></Response>", { status: 500, headers: { "Content-Type": "text/xml" } });
  }
}
