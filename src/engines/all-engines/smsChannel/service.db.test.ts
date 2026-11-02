// handleInboundSms() against a REAL Postgres, inside one rolled-back
// transaction. Skipped without DATABASE_URL (describeWithDb).

import { expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { describeWithDb, loadDb } from "@/tenancy/testing";
import type { TenantTx } from "@/tenancy/withTenant";
import { firms, matterParties, matters, parties, users } from "@/db/schema";
import { flags } from "@/db/tables/foundation";
import { handleInboundSms } from "./service";

class Rollback extends Error {}

describeWithDb("handleInboundSms against Postgres", () => {
  it("matches by phone, honours STOP/START, and logs an ordinary message as an internal flag", async () => {
    const { rawDb } = await loadDb();
    try {
      await rawDb.transaction(async (raw) => {
        const [firm] = await raw.insert(firms).values({ name: "SMS Test Firm", slug: `sms-test-${Date.now()}` }).returning({ id: firms.id });
        const tenantId = firm!.id;
        await raw.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
        const tx = raw as unknown as TenantTx;

        const [admin] = await tx
          .insert(users)
          .values({ tenantId, email: "admin@sms-test.example", displayName: "Ada Admin", role: "firm_admin" })
          .returning({ id: users.id });
        const [lawyer] = await tx
          .insert(users)
          .values({ tenantId, email: "lawyer@sms-test.example", displayName: "Lee Lawyer", role: "attorney" })
          .returning({ id: users.id });
        const [client] = await tx
          .insert(parties)
          .values({ tenantId, fullName: "Chris Client", normalizedName: "chris client", phone: "+15125550199" })
          .returning({ id: parties.id });
        const [matter] = await tx
          .insert(matters)
          .values({ tenantId, primaryPartyId: client!.id, assignedUserId: lawyer!.id, practiceArea: "family" })
          .returning({ id: matters.id });
        await tx.insert(matterParties).values({ tenantId, matterId: matter!.id, partyId: client!.id, role: "client" });

        // Unrecognised number: flagged to firm admins, no party resolved.
        const unmatched = await handleInboundSms(tx, { tenantId, from: "+19995550000", to: "+15125559999", body: "Hello?", providerMessageId: "SM0" });
        expect(unmatched.kind).toBe("unmatched");
        if (unmatched.kind === "unmatched") {
          const [flag] = await tx.select().from(flags).where(eq(flags.id, unmatched.flagId));
          expect(flag!.recipientUserIds).toEqual([admin!.id]);
        }

        // Ordinary message from a known client: logged to the assigned lawyer, internal only.
        const logged = await handleInboundSms(tx, {
          tenantId,
          from: "(512) 555-0199",
          to: "+15125559999",
          body: "Can you call me about the hearing?",
          providerMessageId: "SM1",
        });
        expect(logged).toMatchObject({ kind: "logged", partyId: client!.id, matterId: matter!.id });
        if (logged.kind === "logged") {
          const [flag] = await tx.select().from(flags).where(eq(flags.id, logged.flagId));
          expect(flag).toMatchObject({ audience: "internal", type: "sms.inbound_received", matterId: matter!.id });
          expect(flag!.recipientUserIds).toEqual(expect.arrayContaining([lawyer!.id]));
          expect(flag!.recipientPartyIds).toEqual([]);
        }

        // STOP: consent withdrawn on the party, not just on this one message.
        const stopped = await handleInboundSms(tx, { tenantId, from: "+15125550199", to: "+15125559999", body: "STOP", providerMessageId: "SM2" });
        expect(stopped).toEqual({ kind: "opted_out", partyId: client!.id });
        const [afterStop] = await tx.select({ safeContact: parties.safeContact }).from(parties).where(eq(parties.id, client!.id));
        expect(afterStop!.safeContact?.smsAllowed).toBe(false);

        // START: re-opts in with a fresh consent timestamp.
        const started = await handleInboundSms(tx, { tenantId, from: "+15125550199", to: "+15125559999", body: "START", providerMessageId: "SM3" });
        expect(started).toEqual({ kind: "opted_in", partyId: client!.id });
        const [afterStart] = await tx.select({ safeContact: parties.safeContact }).from(parties).where(eq(parties.id, client!.id));
        expect(afterStart!.safeContact?.smsAllowed).toBe(true);
        expect(afterStart!.safeContact?.smsConsentAt).toBeTruthy();

        // Repeating the same providerMessageId must not raise a second flag (dedupe).
        await handleInboundSms(tx, { tenantId, from: "+15125550199", to: "+15125559999", body: "Can you call me about the hearing?", providerMessageId: "SM1" });
        const matches = await tx.select().from(flags).where(eq(flags.type, "sms.inbound_received"));
        expect(matches).toHaveLength(1);

        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  });
});
