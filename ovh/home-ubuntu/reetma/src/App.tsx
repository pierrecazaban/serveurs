import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { HelmetProvider, type HelmetServerState } from "react-helmet-async";
import type { ReactNode } from "react";
import { AuthProvider, RequireAdmin } from "@/hooks/useAuth";
import { Analytics as VercelAnalytics, type BeforeSend } from "@vercel/analytics/react";
import { isTrackingOptedOut } from "@/lib/track";
import { ScrollToTop } from "@/components/ScrollToTop";
import PublicLayout from "@/components/layout/PublicLayout";

// Pages
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import Registrations from "./pages/admin/Registrations";
import AdminLayout from "@/components/layout/AdminLayout";
import LegalNotice from "./pages/legal/LegalNotice";
import Privacy from "./pages/legal/Privacy";
import School from "./pages/school/School";
import SchoolConfirmation from "./pages/school/Confirmation";
import SchoolTerms from "./pages/school/Terms";
import SchoolRefundPolicy from "./pages/school/RefundPolicy";
import Ecole from "./pages/ecole/Ecole";
import EcoleConditions from "./pages/ecole/Conditions";
import EcoleRemboursement from "./pages/ecole/Remboursement";
import HelpCenter from "./pages/help/HelpCenter";
import BookCall from "./pages/booking/BookCall";
import CancelCall from "./pages/booking/CancelCall";
import StudentLogin from "./pages/account/Login";
import ResetPassword from "./pages/account/ResetPassword";
import StudentDashboard from "./pages/account/Dashboard";
import ModulePage from "./pages/account/ModulePage";
import FinalTest from "./pages/account/FinalTest";
import CertificatePage from "./pages/account/CertificatePage";
import CertificateVerify from "./pages/CertificateVerify";
import AdminTickets from "./pages/admin/Tickets";
import AdminStats from "./pages/admin/Stats";
import NotFound from "./pages/NotFound";


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      // At build time (src/entry-server.tsx) a timer per query would keep Node alive 30 min after the pages are written.
      gcTime: typeof window === "undefined" ? Infinity : 1000 * 60 * 30,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: 1,
    },
  },
});

// Vercel Web Analytics gets the page and campaign parameters only: the query string carries ?pid=, ?token= and
// ?ref= (a registration reference), and a certificate address names its holder. Defined once, outside App: the
// component registers beforeSend again each time the function changes.
const analyticsBeforeSend: BeforeSend = (event) => {
  if (isTrackingOptedOut() || event.url.includes("/admin")) return null;
  const url = new URL(event.url);
  url.hash = "";
  for (const k of [...url.searchParams.keys()]) if (!/^utm_[a-z]+$/.test(k)) url.searchParams.delete(k);
  url.pathname = url.pathname.replace(/^\/(certificate?)\/[^/]+/i, "/$1/-");
  return { ...event, url: url.toString() };
};

// Detect Internet Explorer (unsupported)
const isIE = typeof document !== 'undefined' && !!(document as any).documentMode;

// The app is rendered twice from the same pieces: in the browser (App, below) and at build time
// (src/entry-server.tsx, which prerenders the public pages for visitors that do not run JavaScript).

/** The providers above the router. At build time, `helmetContext` collects the <head> tags set by <Seo />. */
export function AppProviders({ helmetContext, children }: { helmetContext?: { helmet?: HelmetServerState | null }; children: ReactNode }) {
  return (
    <HelmetProvider context={helmetContext}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          {children}
        </TooltipProvider>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

/** The route tree, rendered inside a router: BrowserRouter in the browser, StaticRouter at build time. */
export function AppRoutes() {
  return (
    <>
      <ScrollToTop />
      <AuthProvider>
        <Routes>
          {/* Public pages */}
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/legal/mentions" element={<LegalNotice />} />
            <Route path="/legal/privacy" element={<Privacy />} />

            {/* L'École */}
            <Route path="/school" element={<School />} />
            <Route path="/school/confirmation" element={<SchoolConfirmation />} />
            <Route path="/school/terms" element={<SchoolTerms />} />
            <Route path="/school/refund-policy" element={<SchoolRefundPolicy />} />

            {/* L'École in French (same components, language taken from the URL) */}
            <Route path="/ecole" element={<Ecole />} />
            <Route path="/ecole/confirmation" element={<SchoolConfirmation />} />
            <Route path="/ecole/conditions" element={<EcoleConditions />} />
            <Route path="/ecole/remboursement" element={<EcoleRemboursement />} />

            {/* Help center: tickets answered from the back office */}
            <Route path="/help" element={<HelpCenter />} />
            <Route path="/aide" element={<HelpCenter />} />

            {/* Booking calendar for businesses: a booking becomes a ticket of category "call" */}
            <Route path="/book-a-call" element={<BookCall />} />
            <Route path="/prendre-rendez-vous" element={<BookCall />} />
            <Route path="/book-a-call/cancel" element={<CancelCall />} />
            <Route path="/prendre-rendez-vous/annuler" element={<CancelCall />} />

            {/* Student space */}
            <Route path="/school/login" element={<StudentLogin />} />
            <Route path="/ecole/connexion" element={<StudentLogin />} />
            <Route path="/school/reset-password" element={<ResetPassword />} />
            <Route path="/ecole/nouveau-mot-de-passe" element={<ResetPassword />} />
            <Route path="/school/account" element={<StudentDashboard />} />
            <Route path="/ecole/compte" element={<StudentDashboard />} />
            <Route path="/school/account/module/:key" element={<ModulePage />} />
            <Route path="/ecole/compte/module/:key" element={<ModulePage />} />
            <Route path="/school/account/test" element={<FinalTest />} />
            <Route path="/ecole/compte/test" element={<FinalTest />} />
            <Route path="/school/account/certificate" element={<CertificatePage />} />
            <Route path="/ecole/compte/certificat" element={<CertificatePage />} />
            <Route path="/certificate/:code" element={<CertificateVerify />} />
            <Route path="/certificat/:code" element={<CertificateVerify />} />

            {/* Unknown addresses */}
            <Route path="*" element={<NotFound />} />
          </Route>

          {/* Auth (required to access /admin) */}
          <Route path="/auth" element={<Auth />} />
          <Route path="/login" element={<Navigate to="/auth?mode=login" replace />} />

          {/* Admin routes */}
          <Route element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
            <Route path="/admin" element={<Registrations />} />
            <Route path="/admin/stats" element={<AdminStats />} />
            <Route path="/admin/tickets" element={<AdminTickets />} />
          </Route>
          <Route path="/admin/*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </AuthProvider>
    </>
  );
}

const App = () => {
  if (isIE) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-8">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold mb-4">Navigateur non supporté</h1>
          <p className="text-muted-foreground mb-4">
            REETMA nécessite un navigateur moderne.
            Veuillez utiliser Chrome, Firefox, Safari ou Edge.
          </p>
        </div>
      </div>
    );
  }

  return (
    <AppProviders>
      <BrowserRouter>
        <VercelAnalytics beforeSend={analyticsBeforeSend} />
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
};

export default App;
