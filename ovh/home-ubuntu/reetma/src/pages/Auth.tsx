import { useEffect, useState } from "react";
import { Eye, EyeOff, ShieldCheck, Lock } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Seo } from "@/components/Seo";
import reetmaLogo from "@/assets/reetma-logo.png";
import reetmaLogoLight from "@/assets/reetma-logo-light.png";

const BRAND = "#305D55";
const BRAND_DEEP = "#1F3B36";

export default function Auth() {
  const [params] = useSearchParams();
  const redirect = params.get("redirect");
  const target = redirect && redirect.startsWith("/admin") ? redirect : "/admin";
  const { isAdmin, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAdmin) navigate(target, { replace: true });
  }, [isAdmin, navigate, target]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    const res = await signIn(email, password);
    setLoading(false);
    if (res.ok) {
      toast.success("Connexion réussie");
      return;
    }
    const error = "error" in res ? res.error : "";
    toast.error(
      error === "not_configured"
        ? "Le compte du back office n'est pas encore configuré (ADMIN_EMAIL et ADMIN_PASSWORD sur Vercel)."
        : error === "rate_limited"
          ? "Trop de tentatives. Patientez quelques minutes."
          : error === "network"
            ? "Le serveur ne répond pas. Vérifiez votre connexion et réessayez."
            : "E-mail ou mot de passe incorrect.",
    );
  }

  return (
    <div className="min-h-screen bg-white flex" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <Seo title="Back office | Reetma" description="Connexion au back office de Reetma" path="/auth" lang="fr" noindex />
      <div className="flex-1 grid lg:grid-cols-[1.1fr_1fr]">
        <div
          className="hidden lg:flex relative overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${BRAND_DEEP} 0%, ${BRAND} 100%)` }}
        >
          <div
            className="absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
              backgroundSize: "56px 56px",
            }}
          />
          <div className="relative z-10 flex flex-col justify-between p-14 w-full">
            <div className="flex items-center gap-4">
              <img src={reetmaLogoLight} alt="Reetma" className="h-9 w-auto" />
              <div className="h-6 w-px bg-white/25" />
              <span className="text-white/70 text-[10px] tracking-[0.3em] uppercase font-medium">Back office</span>
            </div>
            <div className="max-w-lg">
              <h2 className="text-white text-[44px] xl:text-[52px] font-semibold leading-[1.05] tracking-tight">
                Le back office de Reetma
              </h2>
              <p className="text-white/65 text-[15px] mt-7 leading-relaxed font-light max-w-md">
                Inscriptions et paiements de L'École lus en direct depuis Stripe (et Mollie pour les plus anciennes), tickets du centre d'aide et statistiques du site.
              </p>
            </div>
            <div className="space-y-6">
              <div className="flex items-center gap-8 text-white/55 text-[11px] font-medium tracking-wide">
                <span className="inline-flex items-center gap-2"><ShieldCheck className="w-4 h-4" strokeWidth={1.8} />Réservé à l'administrateur</span>
                <span className="inline-flex items-center gap-2"><Lock className="w-4 h-4" strokeWidth={1.8} />Connexion chiffrée</span>
              </div>
              <div className="h-px bg-gradient-to-r from-white/20 via-white/10 to-transparent" />
              <p className="text-white/40 text-[11px] tracking-wide">© {new Date().getFullYear()} Reetma. Tous droits réservés.</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center p-8">
          <div className="w-full max-w-[400px]">
            <img src={reetmaLogo} alt="Reetma" className="h-8 w-auto mb-10 lg:hidden" />
            <h1 className="text-[28px] font-semibold tracking-tight" style={{ color: BRAND_DEEP }}>Connexion</h1>
            <p className="text-sm mt-2 mb-8" style={{ color: "#6B7672" }}>Saisissez l'e-mail et le mot de passe du back office.</p>
            <form onSubmit={submit} className="space-y-5">
              <div>
                <label htmlFor="admin-email" className="block text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "#3A4F4A" }}>
                  E-mail
                </label>
                <input
                  id="admin-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-12 px-4 rounded-lg border bg-[#FBF7F0] text-[14px] outline-none focus:ring-1"
                  style={{ borderColor: "#ECE5D9", color: BRAND_DEEP }}
                  placeholder="E-mail"
                />
              </div>
              <div>
                <label htmlFor="admin-password" className="block text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "#3A4F4A" }}>
                  Mot de passe
                </label>
                <div className="relative">
                  <input
                    id="admin-password"
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-12 px-4 pr-11 rounded-lg border bg-[#FBF7F0] text-[14px] outline-none focus:ring-1"
                    style={{ borderColor: "#ECE5D9", color: BRAND_DEEP }}
                    placeholder="Mot de passe"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
                    aria-label={show ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                    style={{ color: "#9AA49F" }}
                  >
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading || !email || !password}
                className="w-full h-12 rounded-lg text-white text-[14px] font-semibold disabled:opacity-60"
                style={{ background: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_DEEP} 100%)` }}
              >
                {loading ? "Vérification…" : "Se connecter"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
