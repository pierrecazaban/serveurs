export interface University {
  id: string;
  name: string;
  short_name: string;
  state: string;
  email_domains: string[];
  timezone: string;
}

export interface PublicIntake {
  status: "open" | "closed";
  intake_id?: string;
  name?: string;
  capacity?: number;
  seats_left?: number;
}

export interface RegistrationDetails {
  university_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_e164: string;
  phone_country?: string;
  major?: string;
  graduation_year?: number;
  preferred_times?: string[];
  heard_about?: string;
  timezone?: string;
  marketing_opt_in: boolean;
  sms_opt_in: boolean;
  website?: string; // honeypot
}

export type StartRegistrationResult =
  | {
      result: "reserved" | "resume";
      registration_id: string;
      public_ref: string;
      hold_expires_at: string;
      client_token: string;
      checkout_url?: string;
      intake_name?: string;
    }
  | { result: "already_registered"; intake_name?: string }
  | { result: "full"; intake_id?: string; intake_name?: string }
  | { result: "closed"; intake_name?: string }
  | { result: "rate_limited" }
  | { result: "invalid"; errors?: Record<string, string> }
  | { result: "payments_unavailable" }
  | { result: "error" };

export interface RegistrationStatus {
  status: "paid" | "pending_payment" | "payment_failed" | "expired" | "refunded" | "canceled" | "not_found";
  first_name?: string;
  email?: string;
  university_name?: string;
  intake_name?: string;
  public_ref?: string;
  amount_paid_cents?: number;
  currency?: string;
  paid_at?: string;
  lang?: "en" | "fr";
  has_account?: boolean;
}
