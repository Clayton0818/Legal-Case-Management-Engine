// c88 — end-to-end check of the redaction tool and the privilege-change
// weakening rule against a REAL Postgres. Mirrors document.db.test.ts's
// harness: skipped without DATABASE_URL, runs in one rolled-back transaction
// (document_access_log is append-only for app_runtime).

import { it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { describeWithDb, loadDb } from "@/tenancy/testing";
import type { TenantTx } from "@/tenancy/withTenant";
import { firms, matterParties, matters, parties, users } from "@/db/schema";
import { DEFAULT_DOCUMENT_SETTINGS } from "./settings";
import { MemoryStorageAdapter, StubMalwareScanner, StubOcrAdapter } from "./storage/adapters";
import { listAccessLog, loadAccess } from "./access/service";
import { getDocumentDetail, updateDocumentGroup, uploadDocument } from "./store/service";
import { confirmAndApplyRedaction, getRedactionSuggestion, rejectRedactionSuggestion, suggestRedactions } from "./redaction/service";
import { DocumentError } from "./errors";
import type { StaffViewer } from "./access/policy";

class Rollback extends Error {}

const enc = (s: string) => new TextEncoder().encode(s);

describeWithDb("redaction tool and privilege-change weakening (c88) against Postgres", () => {
  it("suggests, confirms and applies a redaction; rejects stale/foreign spans; logs privilege_change", async (ctx) => {
    const { rawDb } = await loadDb();
    const probe = (await rawDb.execute(sql`select to_regclass('public.document_redactions') as t`)) as unknown as { t: string | null }[];
    if (!probe[0]?.t) ctx.skip();

    try {
      await rawDb.transaction(async (raw) => {
        const [firm] = await raw.insert(firms).values({ name: "Redaction Test Firm", slug: `redact-test-${Date.now()}` }).returning({ id: firms.id });
        const tenantId = firm!.id;
        await raw.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
        const tx = raw as unknown as TenantTx;

        const [lawyerRow] = await tx.insert(users).values({ tenantId, email: "l@redact.example", displayName: "Lee", role: "attorney" }).returning({ id: users.id });
        const [paralegalRow] = await tx.insert(users).values({ tenantId, email: "p@redact.example", displayName: "Pat", role: "intake_staff" }).returning({ id: users.id });
        const [client] = await tx.insert(parties).values({ tenantId, fullName: "Ana Rivera", normalizedName: "ana rivera" }).returning({ id: parties.id });
        const [child] = await tx
          .insert(parties)
          .values({ tenantId, fullName: "Sam Rivera", normalizedName: "sam rivera" })
          .returning({ id: parties.id });
        const [matter] = await tx.insert(matters).values({ tenantId, primaryPartyId: client!.id, practiceArea: "family" }).returning({ id: matters.id });
        await tx.insert(matterParties).values({ tenantId, matterId: matter!.id, partyId: child!.id, role: "child" });

        const lawyer: StaffViewer = { kind: "staff", userId: lawyerRow!.id, role: "attorney", permissions: ["documents.read", "documents.write", "documents.approve"] };
        const paralegal: StaffViewer = { kind: "staff", userId: paralegalRow!.id, role: "intake_staff", permissions: ["documents.read", "documents.write"] };
        const adapters = { storage: new MemoryStorageAdapter(), scanner: new StubMalwareScanner(), ocr: new StubOcrAdapter() };

        const { access } = await loadAccess(tx, tenantId, lawyer);
        const lawyerCtx = { tenantId, viewer: lawyer, access, settings: DEFAULT_DOCUMENT_SETTINGS, adapters };
        const paralegalCtx = { ...lawyerCtx, viewer: paralegal, access: (await loadAccess(tx, tenantId, paralegal)).access };

        const upload = await uploadDocument(tx, lawyerCtx, {
          matterId: matter!.id,
          bytes: enc("Client Sam Rivera, SSN 123-45-6789, account 4012888812345678, is a minor."),
          filename: "intake-notes.txt",
          declaredMimeType: "text/plain",
          documentType: "letter",
        });
        expect(upload.textStatus).toBe("extracted");

        // --- Redaction: suggest, then a paralegal (no documents.approve) may not confirm. ---
        const suggestion = await suggestRedactions(tx, lawyerCtx, upload.documentId);
        expect(suggestion.categories.sort()).toEqual(["account_number", "minor_name", "ssn"]);
        expect(suggestion.candidates.some((c) => c.category === "minor_name" && c.preview === "Sam Rivera")).toBe(true);
        expect(suggestion.candidates.some((c) => c.category === "ssn" && c.preview === "123-45-6789")).toBe(true);

        await expect(
          confirmAndApplyRedaction(tx, paralegalCtx, suggestion.redactionId, { confirmedSpans: suggestion.candidates, reason: "PII cleanup" })
        ).rejects.toBeInstanceOf(DocumentError);

        // A span the suggestion never offered is refused.
        await expect(
          confirmAndApplyRedaction(tx, lawyerCtx, suggestion.redactionId, {
            confirmedSpans: [{ start: 0, end: 3, category: "ssn" }],
            reason: "bogus",
          })
        ).rejects.toThrow(/one of this suggestion's spans/);

        // No reason: refused.
        await expect(
          confirmAndApplyRedaction(tx, lawyerCtx, suggestion.redactionId, { confirmedSpans: suggestion.candidates, reason: "   " })
        ).rejects.toThrow(/reason is required/);

        const applied = await confirmAndApplyRedaction(tx, lawyerCtx, suggestion.redactionId, {
          confirmedSpans: suggestion.candidates,
          reason: "Removing minor's name and financial identifiers before producing to opposing counsel.",
        });
        expect(applied.spanCount).toBe(3);

        const detail = await getDocumentDetail(tx, lawyerCtx, applied.redactedDocumentId);
        expect(detail.document.version).toBe(2);
        expect(detail.document.clientVisible).toBe(false); // never auto-shared
        expect(detail.versions.map((v) => v.isCurrent)).toEqual([true, false]);

        // Re-fetching an already-applied suggestion no longer offers candidates, and a second confirm is refused.
        const refetched = await getRedactionSuggestion(tx, lawyerCtx, suggestion.redactionId);
        expect(refetched.status).toBe("applied");
        await expect(
          confirmAndApplyRedaction(tx, lawyerCtx, suggestion.redactionId, { confirmedSpans: suggestion.candidates, reason: "again" })
        ).rejects.toThrow(/already 'applied'/);

        // A fresh suggestion against the new (already redacted) version may be declined.
        const second = await suggestRedactions(tx, lawyerCtx, applied.redactedDocumentId);
        const declined = await rejectRedactionSuggestion(tx, lawyerCtx, second.redactionId, "Nothing left worth removing.");
        expect(declined.status).toBe("rejected");

        const redactionLog = (await listAccessLog(tx, tenantId, { matterId: matter!.id })).filter((l) => l.action === "redaction");
        expect(redactionLog).toHaveLength(1);
        expect(redactionLog[0]!.outcome).toBe("allowed");

        // --- Privilege-change weakening: lifting a privilege tag needs documents.approve AND a reason. ---
        const privileged = await uploadDocument(tx, lawyerCtx, {
          matterId: matter!.id,
          bytes: enc("Attorney work product memo."),
          filename: "memo.txt",
          declaredMimeType: "text/plain",
          documentType: "memo",
          privilegeTag: "privileged",
        });

        await expect(updateDocumentGroup(tx, paralegalCtx, privileged.groupId, { privilegeTag: "none", reason: "trying anyway" })).rejects.toThrow(
          /Only an attorney/
        );
        await expect(updateDocumentGroup(tx, lawyerCtx, privileged.groupId, { privilegeTag: "none" })).rejects.toThrow(/reason is required/);

        const lifted = await updateDocumentGroup(tx, lawyerCtx, privileged.groupId, { privilegeTag: "none", reason: "Reviewed: not actually privileged." });
        expect(lifted.changed).toBe(true);

        const privilegeLog = (await listAccessLog(tx, tenantId, { matterId: matter!.id })).filter((l) => l.action === "privilege_change");
        expect(privilegeLog).toHaveLength(1);
        expect(privilegeLog[0]!.outcome).toBe("allowed");
        expect(privilegeLog[0]!.detail).toMatchObject({ weakened: true, reason: "Reviewed: not actually privileged." });

        // Tightening (none -> confidential) is not a weakening change: no reason needed.
        const tightened = await updateDocumentGroup(tx, paralegalCtx, privileged.groupId, { privilegeTag: "confidential" });
        expect(tightened.changed).toBe(true);

        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  });
});
