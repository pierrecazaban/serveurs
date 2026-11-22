import { Link } from "react-router-dom";
import { SCHOOL_PATHS, useSchoolLang, type SchoolLang } from "@/lib/school/lang";

/**
 * Link to the help center, in the language of the page. The site shows no support email address:
 * every question goes through a ticket, answered from the back office.
 */
export function HelpCenterLink({
  className = "",
  lang,
  children,
  topic,
  plain = false,
  style,
  onClick,
}: {
  className?: string;
  lang?: SchoolLang;
  children?: React.ReactNode;
  /** Preselects the ticket category, e.g. "project" for a consulting request. */
  topic?: string;
  /** No underline: for links styled as buttons. */
  plain?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  const pageLang = useSchoolLang();
  const l = lang ?? pageLang;
  const label = children ?? (l === "fr" ? "centre d'aide" : "help center");
  const to = SCHOOL_PATHS[l].help + (topic ? `?topic=${encodeURIComponent(topic)}` : "");
  return (
    <Link to={to} className={`${plain ? "" : "underline "}${className}`} style={style} onClick={onClick}>
      {label}
    </Link>
  );
}
