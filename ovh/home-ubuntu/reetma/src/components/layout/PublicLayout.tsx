import { Outlet } from "react-router-dom";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { usePresence } from "@/lib/presence";

export default function PublicLayout() {
  usePresence(); // mesure d'audience du back-office : la page de chaque visite, toutes les 60 s
  return (
    <div className="min-h-screen bg-background">
      <LandingHeader />
      <main>
        <Outlet />
      </main>
      <LandingFooter />
    </div>
  );
}
