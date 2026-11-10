import { documentRoute } from "@/app/api/document/_lib/route";
import { assertUuidParam } from "@/engines/document/http";
import { getRedactionSuggestion } from "@/engines/document/redaction/service";

export const dynamic = "force-dynamic";

/** c88 — re-fetch a redaction suggestion (fresh preview; `stale: true` if the text changed since it was made). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return documentRoute("GET /api/document/redactions/[id]", (c) => getRedactionSuggestion(c.tx, c, assertUuidParam(id, "redaction id")));
}
