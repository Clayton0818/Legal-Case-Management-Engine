import { documentRoute } from "@/app/api/document/_lib/route";
import { assertUuidParam, readJson, str, type Body } from "@/engines/document/http";
import { DocumentError } from "@/engines/document/errors";
import { confirmAndApplyRedaction, type RedactionSpan } from "@/engines/document/redaction/service";

export const dynamic = "force-dynamic";

const CATEGORIES = new Set(["ssn", "account_number", "minor_name"]);

function parseSpans(body: Body): RedactionSpan[] {
  const raw = body.confirmedSpans;
  if (!Array.isArray(raw) || raw.length === 0) throw new DocumentError("'confirmedSpans' must be a non-empty array.", 422);
  return raw.map((s, i) => {
    if (!s || typeof s !== "object") throw new DocumentError(`confirmedSpans[${i}] must be an object.`, 422);
    const { start, end, category } = s as Record<string, unknown>;
    if (!Number.isInteger(start) || !Number.isInteger(end)) throw new DocumentError(`confirmedSpans[${i}].start/end must be integers.`, 422);
    if (typeof category !== "string" || !CATEGORIES.has(category)) throw new DocumentError(`confirmedSpans[${i}].category must be one of ${[...CATEGORIES].join(", ")}.`, 422);
    return { start: start as number, end: end as number, category } as RedactionSpan;
  });
}

/**
 * c88 — step 2: a human reviews the suggestion and explicitly confirms the
 * EXACT spans to permanently remove, with a reason. Confirming and applying
 * happen together (see redaction/service.ts header) — there is no separate
 * "confirmed but not applied" state. Body: { confirmedSpans: [{ start, end,
 * category }], reason }. Needs documents.approve.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return documentRoute("POST /api/document/redactions/[id]/confirm", async (c) => {
    const body = await readJson(req);
    const confirmedSpans = parseSpans(body);
    const reason = str(body, "reason", { required: true, max: 2000 })!;
    return confirmAndApplyRedaction(c.tx, c, assertUuidParam(id, "redaction id"), { confirmedSpans, reason });
  });
}
