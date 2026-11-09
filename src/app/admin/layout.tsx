// Admin/staff console (board card c24). Real path segment (/admin/...), not
// a Next.js route group -- the URL distinction matters here since this is a
// staff-only surface, separate from the client-facing /chat/... path, and
// eventually sits behind real auth (Clerk/WorkOS, ADR-0001 §D8) once that's
// wired up. `middleware.ts`'s auth stub currently tags every request as
// unauthenticated -- do not treat this layout as access-controlled yet.
//
// Calm light shell (founder direction 2026-11-09, refining GlassMinimal3D):
// a quiet translucent top bar with the product name and plain text links on
// tablet/desktop, a floating light bar at the bottom on phones (see
// AdminNav), on the soft pastel `.glass-bg` field. No dark sidebar. The
// content area still carries `.lux` so older inner pages pick up the white
// card / pill-button finish without edits.
//
// `--brand` is set here, inline, from this tenant's firmSettings.brandAccentColor
// (board card: founder-direct "color code their page" request, 2026-11-03) --
// every indigo/sky/blue-colored utility site-wide re-tints from this one
// value (tailwind.config.js). Best-effort: auth is still a stub (see below),
// so a failure to resolve a tenant just falls back to the product default
// set in globals.css, instead of breaking the console.
import Link from "next/link";
import { AdminBottomNav, AdminTopNav } from "./_components/AdminNav";

async function brandAccentColor(): Promise<string | null> {
  try {
    const [{ resolveRequestTenantId }, { withTenant }, { getFirmSettings }] = await Promise.all([
      import("@/auth/request"),
      import("@/tenancy/withTenant"),
      import("@/core/firmSettings"),
    ]);
    const tenantId = await resolveRequestTenantId();
    return await withTenant(tenantId, async (tx) => (await getFirmSettings(tx, tenantId)).brandAccentColor);
  } catch {
    return null;
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const brand = await brandAccentColor();
  const style = brand ? ({ "--brand": brand } as React.CSSProperties) : undefined;
  return (
    <div className="glass-bg min-h-screen" style={style}>
      <header className="sticky top-0 z-40 border-b border-black/[0.04] bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-6 px-4 md:px-6">
          <Link href="/admin" className="shrink-0 text-[0.95rem] font-semibold tracking-tight text-slate-900">
            Practice Engine
          </Link>
          <nav aria-label="Staff console" className="hidden md:block">
            <AdminTopNav />
          </nav>
          <span className="hidden w-[7.5rem] shrink-0 lg:block" aria-hidden="true" />
        </div>
      </header>

      <div className="lux mx-auto max-w-6xl px-4 pb-28 pt-8 md:px-6 md:pb-12 md:pt-10">{children}</div>

      {/* Phone: floating bottom bar */}
      <nav aria-label="Staff console" className="fixed inset-x-3 bottom-3 z-40 md:hidden">
        <AdminBottomNav />
      </nav>
    </div>
  );
}
