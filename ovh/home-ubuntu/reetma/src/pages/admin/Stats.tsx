import { useState, type ReactNode } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import { Seo } from "@/components/Seo";
import { FunnelChart } from "@/components/admin/FunnelChart";
import { OnlinePages } from "@/components/admin/OnlinePages";
import { Panel, Segmented } from "@/components/admin/StatsUi";
import { useAuth } from "@/hooks/useAuth";
import { isUnauthorized } from "@/lib/admin";
import { isTrackingOptedOut } from "@/lib/track";
import { IDLE_MS } from "@/lib/presence";
import {
  BAR,
  INK,
  RANGES,
  RULE,
  fmtCount,
  fmtTime,
  liveFunnel,
  resetStats,
  useFunnelStats,
  useLiveStats,
  type StatsRange,
} from "@/components/admin/statsApi";

function StatTile({ label, value, note, hero = false }: { label: string; value: string; note: string; hero?: boolean }) {
  return (
    <div className="rounded-lg border bg-white p-4 sm:p-5" style={{ borderColor: RULE }}>
      <dt className="flex items-center gap-2 text-sm font-medium" style={{ color: INK.secondary }}>
        {hero && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: BAR }} />}
        {label}
      </dt>
      <dd
        className={`mt-2 font-semibold leading-none ${hero ? "text-5xl sm:text-6xl" : "text-3xl sm:text-4xl"}`}
        style={{ color: INK.primary }}
      >
        {value}
      </dd>
      <dd className="mt-2 text-xs" style={{ color: INK.muted }}>{note}</dd>
    </div>
  );
}

function SectionHead({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div>
      <h2 id={id} className="text-lg font-bold" style={{ color: INK.primary }}>{title}</h2>
      <p className="text-sm" style={{ color: INK.secondary }}>{children}</p>
    </div>
  );
}

/** An explanation folded under a section's text, opened on demand. */
function Help({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="text-sm" style={{ color: INK.secondary }}>
      <summary className="w-fit cursor-pointer font-medium" style={{ color: INK.primary }}>{summary}</summary>
      <p className="mt-1 max-w-3xl leading-relaxed">{children}</p>
    </details>
  );
}

const Status = ({ error, children }: { error?: boolean; children: ReactNode }) => (
  <p className="px-2 py-10 text-center text-sm" style={{ color: error ? "#B91C1C" : INK.muted }}>{children}</p>
);

/** A load that failed: an expired session asks to sign in again; anything else is retried on its own. */
function LoadError({ error, what }: { error: unknown; what: string }) {
  const { signOut } = useAuth();
  if (isUnauthorized(error)) {
    return (
      <Status error>
        Votre session a expiré.{" "}
        <button type="button" onClick={signOut} className="font-semibold underline underline-offset-2">
          Se reconnecter
        </button>
      </Status>
    );
  }
  return (
    <Status error>
      Impossible de charger {what} (erreur du serveur ou de la connexion). Nouvel essai automatique dans une minute au plus.
    </Status>
  );
}

/** Other devices (a phone, another browser, a friend's computer) opt out on the privacy policy, at its button. */
function DevicesPanel() {
  const link = `${window.location.origin}/legal/privacy#ne-plus-etre-compte`;
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard?.writeText(link).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => undefined,
    );
  return (
    <section aria-labelledby="stats-devices" className="space-y-3">
      <SectionHead id="stats-devices" title="Vos appareils">
        Ce navigateur {isTrackingOptedOut() ? "n'est pas compté" : "est compté"} dans les statistiques. Pour qu'un autre
        appareil ne soit pas compté (téléphone, autre navigateur, appareil d'un proche), ouvrez-y ce lien une fois et
        cliquez sur « Ne plus être compté sur ce navigateur ».
      </SectionHead>
      <Panel className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 break-all text-sm underline"
          style={{ color: INK.primary }}
        >
          {link.replace(/^https?:\/\//, "")}
        </a>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-md border px-3 py-1.5 text-sm font-semibold"
          style={{ borderColor: "#ECE5D9", color: INK.primary }}
        >
          <span aria-live="polite">{copied ? "Lien copié" : "Copier le lien"}</span>
        </button>
      </Panel>
    </section>
  );
}

export default function AdminStats() {
  const [range, setRange] = useState<StatsRange>("2h");
  const [refreshing, setRefreshing] = useState(false);
  const live = useLiveStats();
  const funnel = useFunnelStats(range);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([live.refetch(), funnel.refetch()]);
    setRefreshing(false);
  };

  const [resetting, setResetting] = useState(false);
  const resetAll = async () => {
    if (!window.confirm("Remettre tous les chiffres à zéro ? Les visites et le tunnel enregistrés jusqu'ici seront effacés.")) return;
    setResetting(true);
    try {
      await resetStats();
      await Promise.all([live.refetch(), funnel.refetch()]);
    } catch {
      window.alert("La remise à zéro a échoué. Réessayez dans un instant.");
    } finally {
      setResetting(false);
    }
  };

  const now = live.data;
  const mode = now?.mode ?? funnel.data?.mode;
  const shown = funnel.data?.funnel;
  const caption = RANGES.find((r) => r.key === (shown?.range ?? range))?.caption ?? "";
  // Automatic refreshes swap the numbers in place; a period change or a manual refresh dims the previous ones meanwhile.
  const onlineDim = refreshing && live.isFetching;
  const funnelDim = funnel.isPlaceholderData || (refreshing && funnel.isFetching);

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      <Seo title="Statistiques | Reetma back office" description="Audience du site et tunnel de vente" path="/admin/stats" lang="fr" noindex />
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: INK.primary }}>Statistiques</h1>
          <p className="text-sm" style={{ color: INK.secondary }}>
            Qui est sur le site en ce moment, et combien de visiteurs vont du formulaire jusqu'au certificat.
          </p>
        </div>
        {/* The longer text of a failed refresh must not move the page: on a narrow screen it wraps beside the button
            instead of pushing it to a new line, and from sm its fixed width keeps the title beside it from reflowing. */}
        <div className="flex items-center gap-3 sm:shrink-0">
          {now && (
            <p className="text-xs sm:w-44 sm:text-right" style={{ color: live.isError ? "#B91C1C" : INK.secondary }}>
              {live.isError ? `Mise à jour impossible, données de ${fmtTime(now.generated_at)}` : `Mis à jour à ${fmtTime(now.generated_at)}`}
            </p>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex shrink-0 items-center gap-2 px-3 py-2 rounded-md border bg-white text-sm"
            style={{ borderColor: RULE, color: INK.secondary }}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" /> Actualiser
          </button>
          <button
            type="button"
            onClick={resetAll}
            disabled={resetting}
            className="inline-flex shrink-0 items-center gap-2 px-3 py-2 rounded-md border bg-white text-sm"
            style={{ borderColor: RULE, color: INK.secondary }}
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" /> {resetting ? "Remise à zéro…" : "Remettre à zéro"}
          </button>
        </div>
      </div>

      {mode === "test" && (
        <p className="rounded-md px-3 py-2 text-xs" style={{ background: "#FDEBDD", color: "#9A4A1A" }}>
          Mode test : vous voyez les visites des previews (clé de paiement de test), pas celles de la production.
        </p>
      )}

      <dl className="grid gap-3 sm:grid-cols-2">
        <StatTile label="En ligne maintenant" value={fmtCount(now?.online.total)} note="mis à jour toutes les 30 secondes" hero />
        <StatTile label="Comptes étudiants" value={fmtCount(now?.accounts.total)} note="ouverts après paiement" />
      </dl>

      <section aria-labelledby="stats-online" className="space-y-3">
        {/* The rule of src/lib/presence.ts (a beat every 60 s while the tab is shown and was used in the last
            IDLE_MS) and of api/track.js (online until window_seconds after the last beat). */}
        <SectionHead id="stats-online" title="Qui est où, en ce moment">
          Les visiteurs présents, page par page : chacun compte tant que son onglet est affiché et qu'il s'en est servi
          dans les {IDLE_MS / 60_000} dernières minutes, puis jusqu'à {now?.online.window_seconds ?? 150} secondes après
          son dernier signal. Le formulaire d'inscription est compté sous la page de L'École.
        </SectionHead>
        <Help summary="Partis payer sur Stripe : comment ils sont comptés">
          Une personne partie payer reste comptée « Sur la page de paiement Stripe » jusqu'à son retour dans le même
          onglet ou sur la page de confirmation dans ce navigateur, 10 minutes au plus. Si elle revient autrement (dans un
          autre navigateur, partie depuis Instagram et revenue dans Safari par exemple, ou sur une autre page dans un
          nouvel onglet), elle peut être comptée deux fois pendant ce délai.
        </Help>
        <Panel className="p-2 sm:p-3">
          {/* Room for 4 rows: the funnel below only moves once more pages than that are busy. */}
          <div
            className="min-h-[15.5rem] transition-opacity sm:min-h-36"
            style={{ opacity: onlineDim ? 0.45 : 1 }}
            aria-busy={onlineDim}
          >
            {now ? (
              <OnlinePages pages={now.online.pages} />
            ) : live.isError ? (
              <LoadError error={live.error} what="les visiteurs en ligne" />
            ) : (
              <Status>Chargement…</Status>
            )}
          </div>
        </Panel>
      </section>

      <section aria-labelledby="stats-live-funnel" className="space-y-3">
        <SectionHead id="stats-live-funnel" title="Tunnel en direct">
          Où en sont les personnes présentes en ce moment, de L'École jusqu'au certificat. Mis à jour toutes les 30 secondes.
        </SectionHead>
        {now ? (
          <FunnelChart stages={liveFunnel(now.online.pages)} caption="en ce moment" dim={onlineDim} />
        ) : (
          <Panel className="p-2 sm:p-3">
            {live.isError ? <LoadError error={live.error} what="le tunnel en direct" /> : <Status>Chargement…</Status>}
          </Panel>
        )}
      </section>

      <section aria-labelledby="stats-funnel" className="space-y-3">
        <SectionHead id="stats-funnel" title="Tunnel de vente">
          De la visite du site jusqu'au certificat : le nombre de personnes à chaque étape. Les étapes après le paiement
          (compte, modules, certificat) sont comptées à la date où elles ont lieu.
        </SectionHead>
        <Segmented label="Période du tunnel" options={RANGES} value={range} onChange={setRange} />
        {shown ? (
          <FunnelChart stages={shown.stages} caption={caption} dim={funnelDim} />
        ) : (
          <Panel className="p-2 sm:p-3">
            {funnel.isError ? (
              <LoadError error={funnel.error} what="le tunnel" />
            ) : (
              <Status>Chargement…</Status>
            )}
          </Panel>
        )}
        {funnel.isError && shown && (
          <p className="text-xs" style={{ color: "#B91C1C" }}>La dernière mise à jour du tunnel a échoué : chiffres précédents affichés.</p>
        )}
      </section>

      <DevicesPanel />

      <p className="text-xs leading-relaxed" style={{ color: INK.secondary }}>
        Mesure sans cookie ni adresse IP : une visite correspond à un onglet ouvert sur le site, oubliée à sa fermeture. Les
        visites des navigateurs qui se sont connectés à l'admin, et celles des navigateurs qui ont refusé la mesure, ne sont
        pas comptées (pour vos autres appareils, voir « Vos appareils » ci-dessus). À partir de « Paiement réussi », tous les
        paiements et tous les comptes sont comptés, y compris ceux de ces navigateurs.
      </p>
    </div>
  );
}
