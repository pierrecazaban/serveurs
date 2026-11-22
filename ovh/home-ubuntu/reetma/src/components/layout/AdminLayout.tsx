import { useEffect } from "react";
import { NavLink, Outlet, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, LayoutDashboard, LifeBuoy, LogOut, ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { adminFetch } from "@/lib/admin";
import { setTrackingOptOut } from "@/lib/track";
import reetmaLogo from "@/assets/reetma-logo.png";

// Tickets stays second: its open-tickets badge must stay in view on narrow screens.
const NAV = [
  { to: "/admin", label: "Tableau de bord", icon: LayoutDashboard, end: true },
  { to: "/admin/tickets", label: "Tickets", icon: LifeBuoy, end: false },
  { to: "/admin/stats", label: "Statistiques", icon: Activity, end: false },
];

// "Voir le site" opens a new tab without this tab's session (sessionStorage stays in its tab): only the opt-out kept
// in this browser leaves that tab out of the audience. Signing in sets it; it is set again whenever the back office
// is shown and when the link is used, for a session that skipped the form or a localStorage cleared since.
const stayOutOfAudience = () => setTrackingOptOut(true);

export default function AdminLayout() {
  const { signOut } = useAuth();
  useEffect(stayOutOfAudience, []);
  // Open tickets, shown as a badge on the Tickets tab.
  const ticketCounts = useQuery({
    queryKey: ["admin", "tickets", "counts"],
    queryFn: () => adminFetch<{ counts: { open: number } }>("/api/admin/tickets?counts=1"),
    refetchInterval: 60_000,
    retry: false,
  });
  const openTickets = ticketCounts.data?.counts.open ?? 0;

  return (
    <div className="min-h-screen" style={{ background: "#FBF7F0" }}>
      <header className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur" style={{ borderColor: "#ECE5D9" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
          <Link to="/admin" className="flex items-center gap-3 shrink-0">
            <img src={reetmaLogo} alt="Reetma" className="h-8 w-auto" />
            <span
              className="hidden sm:inline text-[10px] font-semibold uppercase tracking-[0.25em] px-2 py-1 rounded"
              style={{ background: "#F5EFE5", color: "#6B7672" }}
            >
              Back office
            </span>
          </Link>

          <nav className="flex-1 flex items-center gap-1 overflow-x-auto">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `relative inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                    isActive ? "text-white" : "text-[#3A4F4A] hover:bg-[#F5EFE5]"
                  }`
                }
                style={({ isActive }) => (isActive ? { background: "#305D55" } : undefined)}
              >
                <Icon className="w-4 h-4" />
                {/* Icon only below md, but the tab keeps its name for screen readers (the link is relative, so this
                    hidden name stays inside the scrolling menu and never widens the page). */}
                <span className="sr-only md:not-sr-only">{label}</span>
                {to === "/admin/tickets" && openTickets > 0 && (
                  <span
                    className="min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold leading-5 tabular-nums"
                    style={{ background: "#F28A4B", color: "#1F3B36" }}
                    aria-label={`${openTickets} ${openTickets > 1 ? "ouverts" : "ouvert"}`}
                  >
                    {openTickets}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              onClick={stayOutOfAudience}
              onAuxClick={stayOutOfAudience}
              className="hidden sm:inline-flex items-center gap-1.5 text-sm text-[#4B5B58] hover:text-[#1F3B36] px-2 py-2"
            >
              Voir le site <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <button
              type="button"
              onClick={() => signOut()}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md hover:bg-[#F5EFE5] text-[#3A4F4A]"
              aria-label="Se déconnecter"
            >
              <LogOut className="w-4 h-4" />
              {/* Text from lg only: below, the Tickets badge needs the room (the button keeps its aria-label). */}
              <span className="hidden lg:inline">Se déconnecter</span>
            </button>
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
