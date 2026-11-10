// CI check: click through the demo walkthrough in a real browser.
//
// Opens /demo on a running server (already seeded by check-demo-seed.ts),
// collects every link in the walkthrough's step sections (pages and APIs,
// with the demo's real matter/session ids already filled in by the page) and
// opens each one. Fails on any HTTP error, any page that shows the staff
// console's error panel or Next's error screen, and any "seed steps that
// failed" notice. Saves a screenshot of every page to
// ./walkthrough-screenshots (uploaded as a CI artifact) so a person can look
// at what each step actually showed.
//
// Usage: BASE_URL=http://localhost:3100 node scripts/ci/walkthrough.mjs
// Needs the `playwright` package and a Chromium browser (the CI job installs
// both; they are not project dependencies).

import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = "walkthrough-screenshots";
const ERROR_MARKERS = [
  "Couldn't load the staff console",
  "Couldn’t load the staff console",
  "Application error",
  "Internal Server Error",
  "Seed steps that failed",
  "Something went wrong",
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const problems = [];
const warnings = [];

async function checkPage(url, label, shot) {
  const res = await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 120_000 });
  const status = res?.status() ?? 0;
  const text = await page.locator("body").innerText();
  const marker = ERROR_MARKERS.find((m) => text.includes(m));
  await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: true });
  if (status >= 400 || marker) problems.push(`${label} (${url}): ${status >= 400 ? `HTTP ${status}` : `shows "${marker}"`}`);
  console.log(`${status >= 400 || marker ? "FAIL" : "ok  "} page ${url}`);
}

await checkPage("/demo", "Demo walkthrough", "00-demo");

const links = await page.$$eval("section[id] a[href]", (as) =>
  as.map((a) => ({ href: a.getAttribute("href"), label: (a.textContent ?? "").trim() }))
);
const seen = new Set();
let n = 0;
for (const { href, label } of links) {
  if (!href || !href.startsWith("/") || seen.has(href)) continue;
  seen.add(href);
  n += 1;
  if (href.startsWith("/api/")) {
    const res = await context.request.get(BASE + href);
    const status = res.status();
    const body = (await res.text()).slice(0, 200);
    // 401/403 = "who is signing in?": expected for some APIs until real login
    // (board card c34) replaces the dev stand-ins. Reported, not failed. A
    // 404 or 5xx is a real break and fails the job.
    if (status === 401 || status === 403) warnings.push(`${label} (${href}): HTTP ${status} ${body}`);
    else if (status >= 400) problems.push(`${label} (${href}): HTTP ${status} ${body}`);
    console.log(`${status < 400 ? "ok  " : status === 401 || status === 403 ? "auth" : "FAIL"} api  ${href}`);
  } else {
    await checkPage(href, label, String(n).padStart(2, "0") + "-" + href.replace(/[^a-z0-9]+/gi, "_").slice(0, 60));
  }
}

await browser.close();
console.log(`\n[walkthrough] ${seen.size} links checked.`);
if (warnings.length) console.log(`[walkthrough] needs sign-in until real login (c34), not counted as failures (${warnings.length}):\n  ${warnings.join("\n  ")}`);
if (seen.size === 0) problems.push("No walkthrough links found on /demo (is the demo firm seeded and DEV_TENANT_ID=current-demo?)");
if (problems.length) {
  console.error(`[walkthrough] FAIL (${problems.length}):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("[walkthrough] OK");
