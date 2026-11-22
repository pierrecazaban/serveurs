import { isPlaceholder } from "@/config/school";

/**
 * Renders a config value. Unfilled [PLACEHOLDER] values are shown
 * with a visible marker so they can't be missed before going live.
 */
export function Fill({ value, className = "" }: { value: string; className?: string }) {
  if (isPlaceholder(value)) {
    return (
      <span
        className={`inline-block rounded-sm border border-dashed border-amber-500 bg-amber-50 px-1.5 py-0.5 text-amber-800 ${className}`}
        title="This information still needs to be filled in"
      >
        {value}
      </span>
    );
  }
  return <span className={className}>{value}</span>;
}
