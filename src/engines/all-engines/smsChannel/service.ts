// c113 — Two-way SMS/text channel for client communication (All engines ·
// cross-cutting). Every mainstream competitor treats two-way text as a core
// channel (c15 follow-up competitive scan, 2026-10-15); today every
// client-facing channel is email + the portal (c51, c54, c64) plus the
// intake engine's own one-way-in SMS during triage (c65/c70).
//
// This is the INBOUND half: a real vendor adapter (src/integrations/sms) and
// this webhook-facing service. It does three things, in order, same as the
// intake engine's own channel handling:
//   1. Honour a TCPA opt-out/opt-in/help keyword — safe without any approval.
//   2. Resolve the sender to a party of this firm by phone number.
//   3. Raise an INTERNAL flag so a human sees the message and can reply
//      (c37's attention queue) — the AI never auto-replies with case
//      content, and no two-way thread/UI exists yet (see the PR description
//      for what's deliberately NOT built here).
//
// Consent is stored on `parties.safeContact` (schema.ts), the SAME field
// src/core/contacts.ts's resolveClientAddress() already reads and the intake
// engine already writes on its own STOP handling — there is one consent
// record per party, not a per-channel copy of it.

import { and, eq, isNull } from "drizzle-orm";
import { matterParties, matters, parties, users } from "@/db/schema";
import type { TenantTx } from "@/tenancy/withTenant";
import type { SafeContactPreferences } from "@/db/types";
import { audit, SYSTEM_ACTOR } from "@/core/audit";
import { raiseFlag } from "@/core/flags";
import { candidatePartyPhones, classifyInboundSmsKeyword, phonesMatch } from "./consent";
import type { InboundSmsInput, InboundSmsOutcome } from "./types";

const ENGINE = "all-engines";

async function firmAdminIds(tx: TenantTx, tenantId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, "firm_admin"), eq(users.status, "active")));
  return rows.map((r) => r.id);
}

/** The party's single most recently-added, still-active matter (if any), for routing the flag. */
async function mostRecentActiveMatterId(tx: TenantTx, tenantId: string, partyId: string): Promise<string | null> {
  const rows = await tx
    .select({ matterId: matterParties.matterId, assignedUserId: matters.assignedUserId, addedAt: matterParties.addedAt })
    .from(matterParties)
    .innerJoin(matters, eq(matters.id, matterParties.matterId))
    .where(and(eq(matterParties.tenantId, tenantId), eq(matterParties.partyId, partyId), isNull(matterParties.endedAt)));
  if (rows.length === 0) return null;
  rows.sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
  return rows[0]!.matterId;
}

async function matterAssignedUserId(tx: TenantTx, tenantId: string, matterId: string): Promise<string | null> {
  const [m] = await tx
    .select({ assignedUserId: matters.assignedUserId })
    .from(matters)
    .where(and(eq(matters.tenantId, tenantId), eq(matters.id, matterId)))
    .limit(1);
  return m?.assignedUserId ?? null;
}

/** All active parties with at least one phone-shaped value, for an in-process match against "from". */
async function findPartyByPhone(tx: TenantTx, tenantId: string, from: string) {
  const rows = await tx
    .select({ id: parties.id, phone: parties.phone, phones: parties.phones, safeContact: parties.safeContact })
    .from(parties)
    .where(eq(parties.tenantId, tenantId));
  return rows.find((p) => candidatePartyPhones(p).some((candidate) => phonesMatch(candidate, from))) ?? null;
}

async function setSmsConsent(tx: TenantTx, tenantId: string, partyId: string, current: SafeContactPreferences | null, next: Partial<SafeContactPreferences>): Promise<void> {
  const safeContact: SafeContactPreferences = { ...(current ?? {}), ...next };
  await tx.update(parties).set({ safeContact }).where(and(eq(parties.tenantId, tenantId), eq(parties.id, partyId)));
}

/**
 * Handle one inbound SMS. Never throws for an ordinary unmatched or
 * keyword message — those are all legitimate, expected outcomes; a thrown
 * error here means something is actually wrong (bad tenantId, DB failure).
 */
export async function handleInboundSms(tx: TenantTx, input: InboundSmsInput, opts: { now?: Date } = {}): Promise<InboundSmsOutcome> {
  const now = opts.now ?? new Date();
  const { tenantId, from, body } = input;
  const keyword = classifyInboundSmsKeyword(body);
  const party = await findPartyByPhone(tx, tenantId, from);

  if (!party) {
    const { flag } = await raiseFlag(
      tx,
      {
        tenantId,
        type: "sms.inbound_unmatched",
        severity: "info",
        audience: "internal",
        title: "Text message from an unrecognised number",
        summary: "No party on file matches this number. Do not reply with any case information until the sender is identified.",
        details: { from: input.from, to: input.to, providerMessageId: input.providerMessageId, keyword },
        recipients: { userIds: await firmAdminIds(tx, tenantId) },
        engine: ENGINE,
        sourceCard: "c113",
      },
      { now }
    );
    await audit(tx, { tenantId, engine: ENGINE, action: "sms.inbound_unmatched", entityType: "flag", entityId: flag.id, actor: SYSTEM_ACTOR, payload: { keyword } });
    return { kind: "unmatched", flagId: flag.id };
  }

  if (keyword === "stop") {
    await setSmsConsent(tx, tenantId, party.id, party.safeContact, { smsAllowed: false });
    await audit(tx, { tenantId, engine: ENGINE, action: "sms.consent_opt_out", entityType: "party", entityId: party.id, actor: SYSTEM_ACTOR, payload: { from: input.from } });
    return { kind: "opted_out", partyId: party.id };
  }

  if (keyword === "start") {
    await setSmsConsent(tx, tenantId, party.id, party.safeContact, { smsAllowed: true, smsConsentAt: now.toISOString() });
    await audit(tx, { tenantId, engine: ENGINE, action: "sms.consent_opt_in", entityType: "party", entityId: party.id, actor: SYSTEM_ACTOR, payload: { from: input.from } });
    return { kind: "opted_in", partyId: party.id };
  }

  const matterId = await mostRecentActiveMatterId(tx, tenantId, party.id);
  const assignedUserId = matterId ? await matterAssignedUserId(tx, tenantId, matterId) : null;
  const admins = await firmAdminIds(tx, tenantId);
  const recipientUserIds = [...new Set([...(assignedUserId ? [assignedUserId] : []), ...admins])];

  if (keyword === "help") {
    const { flag } = await raiseFlag(
      tx,
      {
        tenantId,
        type: "sms.help_requested",
        severity: "info",
        audience: "internal",
        title: "Client texted HELP",
        summary: "Reply with help information by phone, email or the portal — no automated help text is sent (not yet attorney-reviewed copy).",
        details: { partyId: party.id, from: input.from, providerMessageId: input.providerMessageId },
        matterId,
        recipients: { userIds: recipientUserIds.length > 0 ? recipientUserIds : admins },
        engine: ENGINE,
        sourceCard: "c113",
      },
      { now }
    );
    return { kind: "help_requested", partyId: party.id, flagId: flag.id };
  }

  // An ordinary message: the AI never answers with case content (ADR-0001 /
  // src/engines/README.md "founder decisions"); it logs the message for a
  // human and stops there. The message body is internal-only detail — never
  // forwarded to the client side.
  const { flag } = await raiseFlag(
    tx,
    {
      tenantId,
      type: "sms.inbound_received",
      severity: "info",
      audience: "internal",
      title: "New text message from a client",
      summary: body.length > 280 ? `${body.slice(0, 277)}...` : body,
      details: { partyId: party.id, matterId, from: input.from, to: input.to, providerMessageId: input.providerMessageId },
      matterId,
      recipients: { userIds: recipientUserIds.length > 0 ? recipientUserIds : admins },
      dedupeKey: input.providerMessageId ? `sms.inbound.${input.providerMessageId}` : null,
      engine: ENGINE,
      sourceCard: "c113",
    },
    { now }
  );
  await audit(tx, {
    tenantId,
    engine: ENGINE,
    action: "sms.inbound_received",
    entityType: "flag",
    entityId: flag.id,
    matterId,
    actor: SYSTEM_ACTOR,
    payload: { partyId: party.id, providerMessageId: input.providerMessageId },
  });
  return { kind: "logged", partyId: party.id, matterId, flagId: flag.id };
}
