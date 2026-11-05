import { documentRoute } from "@/app/api/document/_lib/route";
import { assertUuidParam, readJson, str } from "@/engines/document/http";
import { rejectRedactionSuggestion } from "@/engines/document/redaction/service";

export const dynamic = "force-dynamic";

/** c88 — a human declines a redaction suggestion outright. Body: { reason }. Needs documents.approve. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return documentRoute("POST /api/document/redactions/[id]/reject", async (c) => {
    const body = await readJson(req);
    const reason = str(body, "reason", { required: true, max: 2000 })!;
    return rejectRedactionSuggestion(c.tx, c, assertUuidParam(id, "redaction id"), reason);
  });
}
