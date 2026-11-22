import { useEffect, useRef, useState } from "react";
import { RotateCcw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSchoolLang } from "@/lib/school/lang";

const TEXT = {
  en: {
    name: "Minimalist agent",
    prompt: "Find 5 marketing internships near campus and draft a cover letter for the best one.",
    steps: ["Searching internship listings near campus", "Comparing them with your résumé", "Drafting the cover letter"],
    found: "Best match found",
    ready: "Cover letter ready to review.",
    caption: "Example of an agent built during the program.",
    replay: "Replay",
    sr: "Minimalist agent demonstration: a student asks an agent to find marketing internships and draft a cover letter, and the agent searches listings, compares them with the résumé and returns a finished draft.",
  },
  fr: {
    name: "Agent minimaliste",
    prompt: "Trouve 5 stages en marketing près du campus et rédige une lettre de motivation pour le meilleur.",
    steps: ["Recherche des offres de stage près du campus", "Comparaison avec votre CV", "Rédaction de la lettre de motivation"],
    found: "Meilleure offre trouvée",
    ready: "Lettre de motivation prête à relire.",
    caption: "Exemple d'agent construit pendant le programme.",
    replay: "Rejouer",
    sr: "Démonstration de l'agent minimaliste : un étudiant demande à un agent de trouver des stages en marketing et de rédiger une lettre de motivation ; l'agent cherche les offres, les compare au CV et rend un brouillon terminé.",
  },
};
const STEP_COUNT = TEXT.en.steps.length;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function AgentDemo() {
  const t = TEXT[useSchoolLang()];
  const reduced = useRef(prefersReducedMotion());
  const containerRef = useRef<HTMLDivElement>(null);
  const hasPlayed = useRef(false);
  const [stage, setStage] = useState(0);
  const [runId, setRunId] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || hasPlayed.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || hasPlayed.current) return;
        hasPlayed.current = true;
        setStarted(true);
        observer.disconnect();
      },
      { threshold: 0.35 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;
    if (reduced.current) {
      setStage(STEP_COUNT + 1);
      return;
    }

    const timers: number[] = [];
    for (let i = 1; i <= STEP_COUNT + 1; i++) {
      timers.push(window.setTimeout(() => setStage(i), 650 * i));
    }
    return () => timers.forEach(clearTimeout);
  }, [runId, started]);

  const done = stage > STEP_COUNT;

  return (
    <div ref={containerRef} className="w-full">
      <div aria-hidden="true" className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className="size-3 rounded-full bg-primary" />
          <span className="text-sm font-semibold text-muted-foreground">
            {t.name}
          </span>
        </div>

        <div className="min-h-[350px] space-y-5 p-5 sm:p-8">
          <div className="flex justify-end">
            <p className="max-w-[82%] rounded-lg bg-primary px-5 py-4 text-base font-semibold leading-snug text-primary-foreground">
              {t.prompt}
            </p>
          </div>

          <div className="space-y-3 pt-1">
            {t.steps.map((step, index) => {
              const visible = stage > index;
              return (
                <div
                  key={step}
                  className="flex items-center gap-4 text-base text-muted-foreground transition-opacity duration-300"
                  style={{ opacity: visible ? 1 : 0 }}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-4" />
                  </span>
                  {step}
                </div>
              );
            })}
          </div>

          <div
            className="rounded-lg border border-border bg-secondary p-5 transition-opacity duration-500"
            style={{ opacity: done ? 1 : 0 }}
          >
            <p className="text-base font-bold text-foreground">
              {t.found}
            </p>
            <p className="mt-1 text-base text-muted-foreground">
              {t.ready}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground/70">
          {t.caption}
        </p>
        {!reduced.current && (
          <Button
            type="button"
            onClick={() => {
              setStage(0);
              setStarted(true);
              setRunId((r) => r + 1);
            }}
            variant="ghost"
            size="sm"
            className="shrink-0 text-sm text-primary"
          >
            <RotateCcw className="size-4" />
            {t.replay}
          </Button>
        )}
      </div>

      <p className="sr-only">
        {t.sr}
      </p>
    </div>
  );
}
