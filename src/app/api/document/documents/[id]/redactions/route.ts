import { documentRoute } from "@/app/api/document/_lib/route";
import { assertUuidParam } from "@/engines/document/http";
import { suggestRedactions } from "@/engines/document/redaction/service";

export const dynamic = "force-dynamic";

/**
 * c88 — step 1 of the redaction tool: run the heuristic detector (SSNs,
 * account numbers, known minors' names) against this version's extracted
 * text and store the (text-free) suggestion. Nothing is changed yet; the
 * response's `candidates` include a preview of each match for a human to
 * review, which is never persisted. POST with no body.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return documentRoute(
    "POST /api/document/documents/[id]/redactions",
    (c) => suggestRedactions(c.tx, c, assertUuidParam(id, "document id")),
    { status: 201 }
  );
}
