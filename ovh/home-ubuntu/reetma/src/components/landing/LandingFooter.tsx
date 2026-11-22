import { HelpCenterLink } from "@/components/school/HelpCenterLink";
import { Link } from "react-router-dom";
import { trackClick } from "@/lib/track";
import { SCHOOL_PATHS } from "@/lib/school/lang";

export function LandingFooter() {
  return (
    <footer className="bg-[#F5EFE5] py-20" style={{ borderTop: "1px solid #ECE5D9" }}>
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          <div>
            <Link to="/" className="font-heading text-lg font-bold" style={{ color: "#1F3B36" }}>
              REETMA
            </Link>
            <p className="text-sm mt-4 leading-relaxed" style={{ color: "#6B7672" }}>
              Technology consulting firm: agentic AI, process automation, data and cloud.
            </p>
            <div className="mt-4 space-y-1 text-xs" style={{ color: "#9AA49F" }}>
              <p>Pierre Cazaban, entrepreneur individuel</p>
              <p>SIREN : 132 067 414</p>
              <p>74 rue du Mas de Caze, 34090 Montpellier, France</p>
              <p>
                <a href="tel:+33670982683" className="hover:text-[#305D55] transition-colors">+33 6 70 98 26 83</a>
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold tracking-[0.2em] uppercase mb-4" style={{ color: "#9AA49F" }}>Expertise</p>
            <div className="space-y-3 text-sm" style={{ color: "#4B5B58" }}>
              <Link to="/#process-automation" className="block hover:text-[#305D55] transition-colors">Process Automation</Link>
              <Link to="/#agentic-ai" className="block hover:text-[#305D55] transition-colors">Agentic AI</Link>
              <Link to="/#data-analytics" className="block hover:text-[#305D55] transition-colors">Data & Cloud</Link>
              <Link to="/#staffing" className="block hover:text-[#305D55] transition-colors">Expert Staffing</Link>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold tracking-[0.2em] uppercase mb-4" style={{ color: "#9AA49F" }}>Company</p>
            <div className="space-y-3 text-sm" style={{ color: "#4B5B58" }}>
              <Link to="/#team" className="block hover:text-[#305D55] transition-colors">About</Link>
              <Link to={SCHOOL_PATHS.en.book} className="block hover:text-[#305D55] transition-colors">Contact</Link>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold tracking-[0.2em] uppercase mb-4" style={{ color: "#9AA49F" }}>Contact</p>
            <HelpCenterLink plain onClick={() => trackClick("help_center")} className="block text-sm mb-6 hover:text-[#305D55] transition-colors" style={{ color: "#4B5B58" }}>
              Help center
            </HelpCenterLink>
            <div className="space-y-2 text-sm" style={{ color: "#4B5B58" }}>
              <Link to="/legal/mentions" className="block hover:text-[#305D55] transition-colors">Mentions légales</Link>
              <Link to="/legal/privacy" className="block hover:text-[#305D55] transition-colors">Politique de confidentialité</Link>
              <Link to={SCHOOL_PATHS.fr.terms} className="block hover:text-[#305D55] transition-colors">Conditions générales de vente</Link>
              <Link to={SCHOOL_PATHS.fr.refund} className="block hover:text-[#305D55] transition-colors">Politique de remboursement</Link>
              <Link to={SCHOOL_PATHS.en.terms} className="block hover:text-[#305D55] transition-colors">Terms &amp; refund policy (English)</Link>
            </div>
          </div>
        </div>

        <div className="mt-16 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4" style={{ borderTop: "1px solid #ECE5D9" }}>
          <p className="text-xs" style={{ color: "#9AA49F" }}>© {new Date().getFullYear()} Reetma · Pierre Cazaban EI · SIREN 132 067 414</p>
        </div>
      </div>
    </footer>
  );
}
