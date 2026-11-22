import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, CalendarX2, Lock, RefreshCw, RotateCcw, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { adminFetch, adminPost, isUnauthorized } from "@/lib/admin";
import { Seo } from "@/components/Seo";
import { CATEGORY_LABELS, isTicketCategory } from "@/components/help/helpApi";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type TicketStatus = "open" | "answered" | "closed";
type Filter = TicketStatus | "all" | "calls";

type Ticket = {
  id: string;
  number: string;
  name: string;
  email: string;
  lang: "en" | "fr";
  category: string;
  reference: string | null;
  subject: string;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
  has_account: boolean;
  // Booked calls (category "call", from /book-a-call): null on other tickets.
  company: string | null;
  role: string | null;
  phone: string | null;
  call_at: string | null;
  call_tz: string | null;
  call_cancelled_at: string | null;
  call_cancelled_by: "booker" | "admin" | null;
};
type TicketRow = Ticket & { last_author: "student" | "admin" | null; last_message: string | null; message_count: number };
type Counts = Record<Filter, number>;
type Message = { id: string; author: "student" | "admin"; body: string; created_at: string };

const FILTERS: { key: Filter; label: string }[] = [
  { key: "open", label: "Ouverts" },
  { key: "answered", label: "Répondus" },
  { key: "closed", label: "Clos" },
  { key: "all", label: "Tous" },
  { key: "calls", label: "Appels" },
];

const STATUS_LABEL: Record<TicketStatus, string> = { open: "Ouvert", answered: "Répondu", closed: "Clos" };
const STATUS_STYLE: Record<TicketStatus, { bg: string; fg: string }> = {
  open: { bg: "#FDEBDD", fg: "#B4561F" },
  answered: { bg: "#E3EDE7", fg: "#305D55" },
  closed: { bg: "#EEE8DD", fg: "#4B5B58" },
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });

const categoryLabel = (c: string) => (isTicketCategory(c) ? CATEGORY_LABELS.fr[c] : c);

// ---- Booked calls (30 minutes, Paris time) ----
const CALL_MS = 30 * 60e3;
const callDay = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Paris" });
const callHour = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
/** "lun. 3 nov. 2026 à 10:30" (Paris time). */
const callWhen = (iso: string) => `${callDay.format(new Date(iso))} à ${callHour.format(new Date(iso))}`;

type CallState = "upcoming" | "ongoing" | "past" | "cancelled";
function callState(t: Ticket): CallState {
  if (t.call_cancelled_at) return "cancelled";
  const start = Date.parse(t.call_at ?? "");
  if (start + CALL_MS <= Date.now()) return "past";
  return start <= Date.now() ? "ongoing" : "upcoming";
}
const CALL_BADGE: Record<CallState, { label: string; bg: string; fg: string }> = {
  upcoming: { label: "À venir", bg: "#E3EDE7", fg: "#305D55" },
  ongoing: { label: "En cours", bg: "#FDEBDD", fg: "#B4561F" },
  past: { label: "Passé", bg: "#EEE8DD", fg: "#4B5B58" },
  cancelled: { label: "Annulé", bg: "#FEF2F2", fg: "#B91C1C" },
};

/** The booker's own time for the call, e.g. "mar. 3 nov., 04:30" (null if the zone is unknown). */
function bookerTime(iso: string, timeZone: string | null): string | null {
  if (!timeZone) return null;
  try {
    return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
  } catch {
    return null;
  }
}

function Badge({ children, bg = "#F5EFE5", fg = "#4B5B58" }: { children: React.ReactNode; bg?: string; fg?: string }) {
  return (
    <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap" style={{ background: bg, color: fg }}>
      {children}
    </span>
  );
}

function CallDetails({ ticket, busy, onCancel }: { ticket: Ticket; busy: boolean; onCancel: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Focus after the dialog: back on "Annuler l'appel" (Retour, Échap), or on this block once the call is cancelled.
  const sectionRef = useRef<HTMLElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmed = useRef(false);
  if (!ticket.call_at) return null;
  const state = callState(ticket);
  const badge = CALL_BADGE[state];
  const local = bookerTime(ticket.call_at, ticket.call_tz);
  const when = callWhen(ticket.call_at);
  const row = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="inline" style={{ color: "#4B5B58" }}>{label} : </dt>
      <dd className="inline break-words">{value}</dd>
    </div>
  );
  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label="Appel réservé"
      className="mt-4 rounded-md border p-4 focus:outline-none"
      style={{ borderColor: "#E3EDE7", background: "#F3F8F5" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-start gap-2 font-semibold" style={{ color: "#1F3B36" }}>
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#305D55" }} aria-hidden="true" />
            <span>Appel le {when} (heure de Paris)</span>
          </p>
          <p className="mt-1 text-sm" style={{ color: "#4B5B58" }}>
            <Badge bg={badge.bg} fg={badge.fg}>{badge.label}</Badge>
            {ticket.call_cancelled_at && (
              <span className="ml-2">
                par {ticket.call_cancelled_by === "admin" ? "Reetma" : "la personne"} le {fmtDate(ticket.call_cancelled_at)}
              </span>
            )}
          </p>
        </div>
        {state === "upcoming" && (
          <button
            ref={cancelButtonRef}
            type="button"
            disabled={busy}
            onClick={() => setConfirmOpen(true)}
            className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"
            style={{ borderColor: "#FECACA", color: "#B91C1C" }}
          >
            <CalendarX2 className="h-4 w-4" aria-hidden="true" /> Annuler l'appel
          </button>
        )}
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" style={{ color: "#1F3B36" }}>
        {row("Entreprise", ticket.company || "—")}
        {row("Fonction", ticket.role || "—")}
        {row("Téléphone", ticket.phone ? <a href={`tel:${ticket.phone.replace(/[^\d+]/g, "")}`} className="underline">{ticket.phone}</a> : "—")}
        {row("E-mail", <span className="break-all">{ticket.email}</span>)}
        {row("Fuseau de la personne", `${ticket.call_tz ?? "—"}${local ? ` (${local} chez elle)` : ""}`)}
      </dl>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          className="max-w-md bg-white"
          closeLabel="Fermer"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (confirmed.current ? sectionRef.current : cancelButtonRef.current)?.focus();
            confirmed.current = false;
          }}
        >
          <DialogHeader>
            <DialogTitle style={{ color: "#1F3B36" }}>Annuler l'appel ?</DialogTitle>
            <DialogDescription>
              L'appel du {when} (heure de Paris) avec {ticket.name}
              {ticket.company ? ` (${ticket.company})` : ""} sera annulé : le créneau redevient libre, {ticket.name} reçoit
              un e-mail d'annulation et le ticket est clos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild>
              <button type="button" className="rounded-md border px-4 py-2 text-sm" style={{ borderColor: "#ECE5D9", color: "#3A4F4A" }}>
                Retour
              </button>
            </DialogClose>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                confirmed.current = true;
                setConfirmOpen(false);
                onCancel();
              }}
              className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "#B91C1C" }}
            >
              <CalendarX2 className="h-4 w-4" aria-hidden="true" /> Annuler l'appel
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function TicketDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const client = useQueryClient();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const query = useQuery({
    queryKey: ["admin", "ticket", id],
    queryFn: () => adminFetch<{ ticket: Ticket; messages: Message[] }>(`/api/admin/tickets?id=${encodeURIComponent(id)}`),
    staleTime: 0,
  });

  const refresh = () => {
    client.invalidateQueries({ queryKey: ["admin", "tickets"] });
    client.invalidateQueries({ queryKey: ["admin", "ticket", id] });
  };

  async function sendReply() {
    const body = reply.trim();
    if (!body || !query.data) return;
    setBusy(true);
    try {
      const res = await adminPost<{ ok: boolean; emailed: boolean; email_error: string | null }>(
        "/api/admin/tickets?action=reply",
        { id, body },
      );
      setReply("");
      if (res.emailed) toast.success(`Réponse envoyée par e-mail à ${query.data.ticket.email}.`);
      else
        toast.warning(
          res.email_error === "not_configured"
            ? "Réponse enregistrée, mais l'e-mail n'est pas parti : Resend n'est pas configuré."
            : "Réponse enregistrée, mais l'e-mail n'a pas pu partir. Réessayez plus tard ou vérifiez Resend.",
        );
      refresh();
    } catch {
      toast.error("La réponse n'a pas pu être enregistrée. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: TicketStatus) {
    setBusy(true);
    try {
      await adminPost("/api/admin/tickets?action=status", { id, status });
      toast.success(status === "closed" ? "Ticket clos." : "Ticket rouvert.");
      refresh();
    } catch {
      toast.error("Le statut n'a pas pu être modifié.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelCall() {
    if (!query.data) return;
    const { ticket } = query.data;
    setBusy(true);
    try {
      const res = await adminPost<{ ok: boolean; emailed: boolean; email_error: string | null }>(
        "/api/admin/tickets?action=cancel_call",
        { id },
      );
      if (res.emailed) toast.success(`Appel annulé : ${ticket.name} a reçu un e-mail d'annulation.`);
      else
        toast.warning(
          res.email_error === "not_configured"
            ? "Appel annulé, mais l'e-mail n'est pas parti : Resend n'est pas configuré."
            : "Appel annulé, mais l'e-mail d'annulation n'a pas pu partir.",
        );
    } catch (err) {
      toast.error(
        (err as { status?: number }).status === 409
          ? "Cet appel est déjà passé ou déjà annulé."
          : "L'appel n'a pas pu être annulé. Réessayez.",
      );
    } finally {
      setBusy(false);
      refresh();
    }
  }

  if (query.isLoading) {
    return <div className="rounded-lg border bg-white p-6 text-sm" style={{ borderColor: "#ECE5D9", color: "#6B7672" }}>Chargement…</div>;
  }
  if (query.isError || !query.data) {
    return (
      <div className="rounded-lg border bg-white p-6 text-sm" style={{ borderColor: "#ECE5D9", color: "#B91C1C" }}>
        Impossible de charger ce ticket.
      </div>
    );
  }

  const { ticket, messages } = query.data;
  const st = STATUS_STYLE[ticket.status];

  return (
    <div className="rounded-lg border bg-white" style={{ borderColor: "#ECE5D9" }}>
      <div className="border-b p-5" style={{ borderColor: "#F5EFE5" }}>
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex items-center gap-1.5 text-sm lg:hidden"
          style={{ color: "#305D55" }}
        >
          <ArrowLeft className="h-4 w-4" /> Retour à la liste
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs" style={{ color: "#6B7672" }}>{ticket.number}</p>
            <h2 className="text-lg font-bold break-words" style={{ color: "#1F3B36" }}>{ticket.subject}</h2>
          </div>
          {ticket.status !== "closed" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setStatus("closed")}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
              style={{ borderColor: "#ECE5D9", color: "#3A4F4A" }}
            >
              <Lock className="h-4 w-4" /> Clore
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setStatus("open")}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
              style={{ borderColor: "#ECE5D9", color: "#3A4F4A" }}
            >
              <RotateCcw className="h-4 w-4" /> Rouvrir
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge bg={st.bg} fg={st.fg}>{STATUS_LABEL[ticket.status]}</Badge>
          <Badge>{categoryLabel(ticket.category)}</Badge>
          <Badge>{ticket.lang.toUpperCase()}</Badge>
          {ticket.has_account && <Badge bg="#E3EDE7" fg="#305D55">Compte étudiant</Badge>}
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" style={{ color: "#4B5B58" }}>
          <div><dt className="inline" style={{ color: "#9AA49F" }}>De : </dt><dd className="inline break-all">{ticket.name} · {ticket.email}</dd></div>
          {ticket.reference && <div><dt className="inline" style={{ color: "#9AA49F" }}>Référence : </dt><dd className="inline font-mono text-xs">{ticket.reference}</dd></div>}
          <div><dt className="inline" style={{ color: "#9AA49F" }}>Créé : </dt><dd className="inline">{fmtDate(ticket.created_at)}</dd></div>
          <div><dt className="inline" style={{ color: "#9AA49F" }}>Mis à jour : </dt><dd className="inline">{fmtDate(ticket.updated_at)}</dd></div>
        </dl>
        <CallDetails ticket={ticket} busy={busy} onCancel={cancelCall} />
      </div>

      <ol className="space-y-4 p-5">
        {messages.map((m) => (
          <li
            key={m.id}
            className={`rounded-md border p-4 ${m.author === "admin" ? "ml-6 sm:ml-12" : "mr-6 sm:mr-12"}`}
            style={{
              borderColor: m.author === "admin" ? "#E3EDE7" : "#ECE5D9",
              background: m.author === "admin" ? "#F3F8F5" : "#FFFFFF",
            }}
          >
            <p className="mb-2 text-xs font-semibold" style={{ color: m.author === "admin" ? "#305D55" : "#6B7672" }}>
              {m.author === "admin" ? "Reetma" : ticket.name} · {fmtDate(m.created_at)}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed" style={{ color: "#1F3B36" }}>{m.body}</p>
          </li>
        ))}
      </ol>

      <div className="border-t p-5" style={{ borderColor: "#F5EFE5" }}>
        <label htmlFor="ticket-reply" className="mb-2 block text-sm font-semibold" style={{ color: "#1F3B36" }}>
          Réponse
        </label>
        <textarea
          id="ticket-reply"
          rows={6}
          maxLength={10000}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={ticket.lang === "fr" ? "Bonjour, …" : "Hello, …"}
          className="w-full rounded-md border bg-white px-3 py-2.5 text-sm outline-none focus:ring-1"
          style={{ borderColor: "#ECE5D9" }}
        />
        <p className="mt-1 text-xs" style={{ color: "#6B7672" }}>
          Envoyée à {ticket.email} depuis l'adresse no-reply, en {ticket.lang === "fr" ? "français" : "anglais"} (langue du ticket). Le ticket passe en « Répondu ».
          {ticket.call_at &&
            (ticket.call_cancelled_at
              ? " L'appel est annulé : l'e-mail le présente comme un appel annulé."
              : " Pour envoyer le lien de la visioconférence, collez-le dans la réponse.")}
        </p>
        <button
          type="button"
          disabled={busy || !reply.trim()}
          onClick={sendReply}
          className="mt-3 inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "#305D55" }}
        >
          <Send className="h-4 w-4" /> {ticket.call_at ? "Envoyer la réponse" : "Envoyer la réponse à l'étudiant"}
        </button>
      </div>
    </div>
  );
}

export default function AdminTickets() {
  const { signOut } = useAuth();
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["admin", "tickets", filter],
    queryFn: () => adminFetch<{ mode: "test" | "live"; tickets: TicketRow[]; counts: Counts }>(`/api/admin/tickets?status=${filter}`),
    staleTime: 0,
  });

  const tickets = query.data?.tickets ?? [];
  const counts = query.data?.counts;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tickets;
    return tickets.filter((t) =>
      [t.number, t.name, t.email, t.subject, t.reference, t.company].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [tickets, q]);

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      <Seo title="Tickets | Reetma back office" description="Demandes du centre d'aide" path="/admin/tickets" lang="fr" noindex />
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: "#1F3B36" }}>Tickets</h1>
          <p className="text-sm" style={{ color: "#6B7672" }}>
            {filter === "calls"
              ? "Appels réservés depuis /book-a-call : à venir d'abord (le plus proche en premier), puis passés ou annulés."
              : "Demandes envoyées depuis le centre d'aide, les plus récentes en premier."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => query.refetch()}
          className="inline-flex items-center gap-2 self-start px-3 py-2 rounded-md border bg-white text-sm sm:self-auto"
          style={{ borderColor: "#ECE5D9", color: "#3A4F4A" }}
        >
          <RefreshCw className={`w-4 h-4 ${query.isFetching ? "animate-spin" : ""}`} /> Actualiser
        </button>
      </div>

      {query.data?.mode === "test" && (
        <p className="rounded-md px-3 py-2 text-xs" style={{ background: "#FDEBDD", color: "#B4561F" }}>
          Mode test : vous voyez les tickets créés sur les previews (clé de paiement de test), pas ceux de la production.
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrer par statut">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              onClick={() => {
                setFilter(key);
                setSelected(null);
              }}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium"
              style={
                filter === key
                  ? { background: "#305D55", borderColor: "#305D55", color: "#FFFFFF" }
                  : { background: "#FFFFFF", borderColor: "#ECE5D9", color: "#3A4F4A" }
              }
            >
              {label}
              {counts && (
                <span className="tabular-nums opacity-80" title={key === "calls" ? "Appels à venir" : undefined}>
                  {counts[key] ?? 0}
                </span>
              )}
            </button>
          ))}
        </div>
        <label className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#9AA49F" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher : numéro, nom, e-mail, objet, référence"
            className="w-full h-10 pl-9 pr-3 rounded-md border bg-white text-sm outline-none focus:ring-1"
            style={{ borderColor: "#ECE5D9" }}
          />
        </label>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
        <div className={`rounded-lg border bg-white ${selected ? "hidden lg:block" : ""}`} style={{ borderColor: "#ECE5D9" }}>
          {query.isLoading && <p className="px-4 py-10 text-center text-sm" style={{ color: "#6B7672" }}>Chargement…</p>}
          {query.isError && (
            <p className="px-4 py-10 text-center text-sm" style={{ color: "#B91C1C" }}>
              {isUnauthorized(query.error) ? (
                <>
                  Votre session a expiré.{" "}
                  <button type="button" onClick={signOut} className="font-semibold underline underline-offset-2">
                    Se reconnecter
                  </button>
                </>
              ) : (
                "Impossible de charger les tickets (erreur du serveur ou de la connexion). Cliquez sur Actualiser pour réessayer."
              )}
            </p>
          )}
          {!query.isLoading && !query.isError && filtered.length === 0 && (
            <p className="px-4 py-10 text-center text-sm" style={{ color: "#6B7672" }}>Aucun ticket.</p>
          )}
          <ul>
            {filtered.map((t) => {
              const st = STATUS_STYLE[t.status];
              const active = selected === t.id;
              return (
                <li key={t.id} className="border-t first:border-t-0" style={{ borderColor: "#F5EFE5" }}>
                  <button
                    type="button"
                    onClick={() => setSelected(t.id)}
                    className="block w-full px-4 py-3 text-left hover:bg-[#FBF7F0]"
                    style={active ? { background: "#F3F8F5" } : undefined}
                    aria-current={active ? "true" : undefined}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs" style={{ color: "#6B7672" }}>{t.number}</span>
                      <span className="text-xs whitespace-nowrap" style={{ color: "#9AA49F" }}>{fmtDate(t.updated_at)}</span>
                    </div>
                    <p className="mt-1 font-semibold break-words" style={{ color: "#1F3B36" }}>{t.subject}</p>
                    <p className="text-xs break-all" style={{ color: "#6B7672" }}>{t.name} · {t.email}</p>
                    {t.call_at && (
                      <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold" style={{ color: "#305D55" }}>
                        <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        Appel le {callWhen(t.call_at)} (heure de Paris)
                      </p>
                    )}
                    {t.last_message && (
                      <p className="mt-1 line-clamp-1 text-xs" style={{ color: "#4B5B58" }}>
                        <span className="font-semibold">{t.last_author === "admin" ? "Reetma : " : ""}</span>
                        {t.last_message}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge bg={st.bg} fg={st.fg}>{STATUS_LABEL[t.status]}</Badge>
                      <Badge>{categoryLabel(t.category)}</Badge>
                      <Badge>{t.lang.toUpperCase()}</Badge>
                      {t.call_at && callState(t) !== "upcoming" && (
                        <Badge bg={CALL_BADGE[callState(t)].bg} fg={CALL_BADGE[callState(t)].fg}>{CALL_BADGE[callState(t)].label}</Badge>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className={selected ? "" : "hidden lg:block"}>
          {selected ? (
            <TicketDetail key={selected} id={selected} onBack={() => setSelected(null)} />
          ) : (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm" style={{ borderColor: "#DDD5C7", color: "#6B7672" }}>
              Sélectionnez un ticket pour lire la demande et y répondre.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
