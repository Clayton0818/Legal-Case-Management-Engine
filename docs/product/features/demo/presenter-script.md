# Demo presenter script (c106)

> **DEMO: fictional data.** Everything shown comes from the fictional firm "DEMO — Example & Sample Family Law (fictional)". Every email address is at example.com and every phone number is in the 555-0100–0199 fiction block. No real person, firm or case appears in it.

This is the script for a 25–35 minute demo of the case-management product for a prospective client firm. The live page is **`/demo`**, which you reach from the **Demo** tile on the home page or the "Demo (fictional data)" button on the staff console. The page follows the same 16 steps as this script. For each step it gives a short explanation, links into the real pages, what the demo firm holds right now, and the talking points below.

## Ground rules: say these out loud, and never contradict them

1. **The product does not give legal advice.** The assistant collects facts, books time and routes work to people.
2. **The system never decides a deadline.** Anything not typed in by a lawyer starts as PROPOSED, and only a lawyer can confirm it.
3. **Software never clears a conflict.** It finds matches, and a designated conflicts attorney decides.
4. **Anything awaiting sign-off says so.** Wording or rules that still need attorney, CPA or vendor approval appear as a visible `[PENDING … REVIEW]` placeholder. When you see one, point at it: it shows the product will not ship unreviewed legal wording or rules. Never describe a pending feature as finished.
5. **Vendors are simulated.** Email, SMS, calendar sync, document storage, OCR, e-signature, payments and bank feeds are stubs in the demo, and the page marks each one "simulated in demo".

If you are asked a legal question ("Is that the right deadline in Texas?"), the answer is: *"That is the firm's lawyer's call. The product records what the lawyer decides and shows who decided."*

## Before the demo (5 minutes)

1. Open `/demo` **first** (it also wakes the server and finds the current demo firm). On a free hosting plan the first load can take about a minute.
2. Press **Reset demo firm**. The reset is an admin action, so run it as the dev administrator (leave `DEV_DEMO_USER` unset) or as the fictional firm administrator Morgan Testwell (`DEV_DEMO_USER=admin`). A reset builds a fresh fictional firm through the product's own services and retires the old one. Nothing is deleted, because audit, trust and access logs are append-only.
3. Reload. With `DEV_TENANT_ID=current-demo` (recommended, see "Deployment needs") the session follows the new firm by itself and the **Presenter setup** box is green. With fixed ids instead, set `DEV_TENANT_ID` and `DEV_USER_ID` to the ids the box shows and restart. While the session points at any other firm, the "open the real page" links stay disabled, so a demo can never show a real firm's data.
4. For lawyer-only actions (confirming a deadline, deciding a conflict), present as the fictional partner Avery Exampleton: `DEV_DEMO_USER=partner`. The partner cannot press Reset, so reset first.
5. Check the seed summary. Expect about 65 steps done, 5 **blocked pending review** and 0 failed. If any step failed, the red box says why. The usual cause is that document storage is not configured on the deployment; see "Deployment needs" below.

## The walkthrough

**1. A prospect chats in.** Open `/chat` and the intake queue.
*Say:* "One queue for every channel. The first replies use wording a lawyer approves. Until then you see the placeholder, which is deliberate. A response clock starts as soon as we have contact details."

**2. Triage and emergency detection.** Robin Fictor's first message mentions a threat. The intake pauses, the safety message shows, and the on-call lawyer is alerted.
*Say:* "It errs on the side of alerting a person. It routes to people; it does not advise. The AI triage model is waiting for its vendor agreement, so in this demo our intake coordinator recorded the practice area herself, and the system records who decided."

**3. Conflict check: clear, possible, definite.**
- **Clear:** Sam Placewell.
- **Possible:** Kai Prototon-Vale named a *former* client by her **maiden name**. The check waits in the conflicts attorney's queue.
- **Definite:** Chris Sampleford is the other side of a current divorce. Avery, the conflicts attorney, **declined it as not waivable**.

*Say:* "The software found it and a lawyer decided. Automatic 'definite' classification uses a rule table that is still pending attorney review. Until then the attorney's decision is what makes it definite. The prospect is never told why."

**4. Booking a consultation.** Booking opens only once the conflict check is clear, with real free slots on the eligible lawyer's calendar.
*Say:* "Booking is refused while a conflict is open. Outlook/Google sync is simulated here."

**5. Case acceptance.** Sam's inquiry was borderline, so a lawyer accepted it and wrote down why.
*Say:* "Borderline inquiries always go to a lawyer. Nobody is auto-declined while auto-decline rules are pending review."

**6. Opening the matter: assignment and hand-offs.** Sam's matter was routed to an eligible lawyer. The matter-open panel lists what is still outstanding. The final **Open matter** step is visibly **blocked**, because the gate list itself awaits attorney approval.
*Say:* "Representation starts only when every gate is met. Hand-offs start automatically after that. E-signature and payments are simulated here."

**7. Calendar and deadlines.** The temporary orders hearing is confirmed. The paralegal's mediation and filing entries are **PROPOSED** until a lawyer confirms them, and the status conference shows a lawyer confirming one. The court-rule deadline calculator is **blocked pending attorney review**.
*Say:* "Only a lawyer confirms deadlines, and the database enforces that too. The system can propose dates from rules the firm's lawyer approved. It never decides them."

**8. Limitation dates.** One date was entered by a lawyer and verified blind by a second lawyer. The other is unverified and is flagged daily.
*Say:* "The product does not compute limitation periods. A lawyer enters the date, and a second person verifies it independently."

**9. Documents.** Show the folder template, the petition (v2 supersedes v1, nothing is overwritten), a search for "mediation", and the access log.
*Say:* "Ethical screens apply to documents, and refusals are logged. Storage, scanning and OCR are simulated here. Retention periods are pending attorney review."

**10. Trust ledger and three-way reconciliation.** The IOLTA account and client ledgers exist. Both retainer deposits are **blocked pending attorney + CPA review**. The bank statement was entered, and the reconciliation is **unbalanced**, listing exactly which bank lines are not yet in the books.
*Say:* "This is the approval system at its clearest. The feature is built and stays off until both the attorney and the CPA sign off. The journal is append-only. Bank feeds are simulated."

**11. Client updates and reply clocks.** Dana's deadline question has an open clock on the shorter deadline track. Pat's question was answered by a lawyer, which stopped that clock. One update was sent, and an automatically drafted one waits for approval.
*Say:* "Only a human reply stops a clock. Drafts never go out unapproved. Emails carry no case details, and in the demo they are held in the outbox."

**12. Court-notice alerts.** A notice from the (fictional) trusted clerk domain was matched by cause number, and it raised a critical internal alert.
*Say:* "Look-alike senders are treated as phishing. Dates found in a notice become proposals, not confirmed deadlines. Mailbox and e-filing are simulated."

**13. Case health and overdue work.** Show the daily health score per matter and the overdue exhibit-list task, which is flagged once.
*Say:* "Firm timers use business hours. Court-related safety nets use the real clock."

**14. Permissions.** Show the role matrix and the access-change log.
*Say:* "Some rights are attorney-only: confirming deadlines, clearing conflicts and approving trust disbursements."

**15. The Family Law pack.** Show the pilot pack. The fictional partner reviewed the DRAFT stage and task-list templates and activated them.
*Say:* "Anything that touches law, such as waiting periods, child support and possession schedules, is pending attorney review and shows as a placeholder."

**16. Admin and ops views.** Show the ops attention queue, the matters queue and insights.
*Say:* "Held emails appear here with their reason. Everything still pending is listed for the firm's reviewers."

## Closing

"Everything you saw ran on the product's real code against a fictional firm. Where something waits for a lawyer, a CPA or a vendor agreement, we showed you the placeholder instead of pretending. That is how it will behave in your firm too."

## Deployment needs (for whoever runs the demo deployment)

Set these on the demo deployment only, never on one that holds real firms:

- `DEMO_RESET_ENABLED=1`. The reset route, the bootstrap route, the CLI and the current-demo session all refuse without it.
- `DEV_TENANT_ID=current-demo` (recommended). The dev-mode session then follows the newest demo firm, so a reset needs no settings change. It only ever lands on a non-production firm that carries an active demo flag, re-checked inside that firm's own transaction, so it can never show a real firm. In this mode `DEV_USER_ID` is not used; choose who you present as with `DEV_DEMO_USER` (`partner`, `admin`, `associate`, `associate2`, `intake`, `bookkeeper` or `paralegal`; unset = the dev administrator). Routes that still read the firm synchronously (for example `/chat`) use the firm found by the last lookup, so open `/demo` once after the server starts.
- The **first** demo firm: set a long random `DEMO_BOOTSTRAP_SECRET`, open `/demo`, type the secret into **Create the demo firm**. It works only while no demo firm exists; remove the secret afterwards. From a terminal instead: `DEMO_RESET_ENABLED=1 npx tsx src/engines/demo/cli.ts create --by "Name"` (`cli.ts status` prints the ids, and `cli.ts retire` switches the demo off).
- In production mode, the document engine refuses in-memory storage. On the demo deployment, set `DOCUMENT_STORAGE=local`, `DOCUMENT_STORAGE_DIR`, `DOCUMENT_STORAGE_KEY` (32 random bytes, base64) and `DOCUMENT_STORAGE_ALLOW_LOCAL=1`. Without them, the document steps fail and `/demo` says so.
- With fixed ids instead of `current-demo`, each reset creates a new firm id, so `DEV_TENANT_ID` / `DEV_USER_ID` must be updated after every reset.
