"use client";

// Staff console navigation (calm light shell, founder direction 2026-11-09).
// Two shapes from one list:
//   - tablet/desktop (md+): a quiet top bar -- product name on the left, the
//     main sections as plain text links in the middle (the current one
//     underlined, see `.nav-link` in globals.css), the rest under "More"
//   - phone (<md): a floating light bar at the bottom with the first three
//     sections plus "More", which opens the full list
// Client component only because the active state needs usePathname().
import Link from "next/link";
import { usePathname } from "next/navigation";

const ADMIN_NAV = [
  { href: "/admin", label: "Matters" },
  { href: "/admin/intake", label: "Intake" },
  { href: "/admin/conflict-check", label: "Conflicts" },
  { href: "/admin/calendar-core", label: "Calendar" },
  { href: "/admin/document", label: "Documents" },
  { href: "/admin/billing-trust", label: "Billing" },
  { href: "/admin/calendar-alerts", label: "Client alerts" },
  { href: "/admin/insights", label: "Insights" },
  { href: "/admin/all-engines", label: "Settings" },
  { href: "/admin/ops", label: "Operations" },
] as const;

/** How many sections show directly in the top bar; the rest go under "More". */
const TOP_COUNT = 6;

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin" || pathname.startsWith("/admin/matters");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function MoreMenu({ items, pathname, align }: { items: readonly (typeof ADMIN_NAV)[number][]; pathname: string; align: "top" | "bottom" }) {
  const anyActive = items.some((item) => isActive(pathname, item.href));
  return (
    <details className="group relative">
      <summary
        aria-current={anyActive ? "page" : undefined}
        className={
          align === "top"
            ? "nav-link cursor-pointer list-none [&::-webkit-details-marker]:hidden"
            : `flex min-h-[48px] cursor-pointer list-none items-center justify-center rounded-full px-2 text-xs [&::-webkit-details-marker]:hidden ${
                anyActive ? "bg-slate-100 font-semibold text-slate-900" : "font-medium text-slate-500"
              }`
        }
      >
        More
      </summary>
      <ul
        className={`absolute z-50 w-52 rounded-2xl border border-black/5 bg-white/95 p-1.5 shadow-xl shadow-slate-900/10 backdrop-blur-xl ${
          align === "top" ? "right-0 top-full mt-1" : "bottom-full right-0 mb-3"
        }`}
      >
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "block rounded-xl bg-slate-100 px-3.5 py-2.5 text-sm font-semibold text-slate-900"
                    : "block rounded-xl px-3.5 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function AdminTopNav() {
  const pathname = usePathname() ?? "";
  return (
    <ul className="flex items-center gap-4 lg:gap-6">
      {ADMIN_NAV.slice(0, TOP_COUNT).map((item) => (
        <li key={item.href}>
          <Link href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined} className="nav-link whitespace-nowrap">
            {item.label}
          </Link>
        </li>
      ))}
      <li>
        <MoreMenu items={ADMIN_NAV.slice(TOP_COUNT)} pathname={pathname} align="top" />
      </li>
    </ul>
  );
}

export function AdminBottomNav() {
  const pathname = usePathname() ?? "";
  return (
    <div className="grid grid-cols-4 gap-1 rounded-full border border-black/5 bg-white/90 p-1.5 shadow-lg shadow-slate-900/10 backdrop-blur-xl">
      {ADMIN_NAV.slice(0, 3).map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "flex min-h-[48px] items-center justify-center rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-900"
                : "flex min-h-[48px] items-center justify-center rounded-full px-2 text-xs font-medium text-slate-500"
            }
          >
            {item.label}
          </Link>
        );
      })}
      <MoreMenu items={ADMIN_NAV.slice(3)} pathname={pathname} align="bottom" />
    </div>
  );
}
