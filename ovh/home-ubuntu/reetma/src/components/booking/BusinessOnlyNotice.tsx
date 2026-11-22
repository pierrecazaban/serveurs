import { Link } from "react-router-dom";
import { SCHOOL_PATHS, type SchoolLang } from "@/lib/school/lang";
import { BOOKING_TEXT } from "@/lib/booking/text";

/**
 * Shown when the company or the email looks like a student's: the calendar is for businesses. Polite, with the way
 * to L'École for students and to the help center for a business refused by mistake. Never lists the rules.
 */
export function BusinessOnlyNotice({ id, lang }: { id: string; lang: SchoolLang }) {
  const t = BOOKING_TEXT[lang].businessOnly;
  return (
    <div
      id={id}
      role="alert"
      className="mt-2 rounded-md p-3 text-sm leading-relaxed"
      style={{ background: "#FDEBDD", border: "1px solid #F5C9A9", color: "#7A3A12" }}
    >
      <p className="font-semibold">{t.lead}</p>
      <p className="mt-1">
        {t.studentsBefore}
        <Link to={SCHOOL_PATHS[lang].home} className="font-semibold underline">
          {t.studentsLink}
        </Link>
        {t.studentsAfter}
      </p>
      <p className="mt-1">
        {t.mistakeBefore}
        <Link to={`${SCHOOL_PATHS[lang].help}?topic=other`} className="font-semibold underline">
          {t.helpLink}
        </Link>
        {t.mistakeAfter}
      </p>
    </div>
  );
}
