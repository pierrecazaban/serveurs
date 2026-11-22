import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMe, type Student } from "@/lib/account";
import { SCHOOL_PATHS, useSchoolLang } from "@/lib/school/lang";

export const STUDENT_QUERY_KEY = ["student-me"] as const;

/** The logged-in student (null when logged out). Cached for the whole session. */
export function useStudent() {
  const query = useQuery({ queryKey: STUDENT_QUERY_KEY, queryFn: fetchMe, staleTime: 5 * 60 * 1000, retry: false });
  return { student: query.data ?? null, isLoading: query.isLoading, refetch: query.refetch };
}

/** Call after login, logout or account creation so every page sees the new state. */
export function useRefreshStudent() {
  const client = useQueryClient();
  return (student: Student | null) => client.setQueryData(STUDENT_QUERY_KEY, student);
}

/** Renders the page only for a logged-in student; otherwise sends them to the login page and back. */
export function RequireStudent({ children }: { children: (student: Student) => ReactNode }) {
  const { student, isLoading } = useStudent();
  const lang = useSchoolLang();
  const location = useLocation();
  if (isLoading) {
    return (
      <div className="pt-32 pb-24 px-6">
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="h-8 w-1/2 animate-pulse rounded" style={{ background: "#ECE5D9" }} />
          <div className="h-40 animate-pulse rounded" style={{ background: "#F5EFE5" }} />
        </div>
      </div>
    );
  }
  if (!student) {
    const back = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`${SCHOOL_PATHS[lang].login}?redirect=${back}`} replace />;
  }
  return <>{children(student)}</>;
}
