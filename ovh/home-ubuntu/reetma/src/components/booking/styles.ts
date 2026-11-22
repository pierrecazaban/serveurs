// Classes and colors shared by the booking pages (the help center's form styles).
export const inputBase =
  "w-full rounded-md border bg-white px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[#305D55]/40";
export const border = (error?: unknown) => ({ borderColor: error ? "#FCA5A5" : "#DDD5C7" });
export const primaryButton =
  "inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#305D55] focus-visible:ring-offset-2";
export const secondaryButton =
  "inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#305D55] focus-visible:ring-offset-2";
export const PRIMARY_STYLE = { background: "#305D55" } as const;
export const SECONDARY_STYLE = { border: "1px solid #305D55", color: "#305D55", background: "#FFFFFF" } as const;
export const ERROR_BOX = { background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C" } as const;
export const INFO_BOX = { background: "#FBF6EE", border: "1px solid #ECE5D9", color: "#3A4F4A" } as const;
