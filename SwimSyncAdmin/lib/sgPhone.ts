// Sanity-checking a Singapore contact number, and the blank→NULL rule that goes
// with it.
//
// WHY THIS EXISTS. `provisional_contact_phone` is the strongest signal
// `find_student_candidates()` has for matching a child to their parent's
// account (20260726000200), and until now nothing anywhere checked its shape.
// Production already holds `964` on a real child — a number that
// `normalize_phone()` correctly refuses, so that child can never be matched by
// phone, and nobody was told.
//
// ⚠ EVERY CHECK HERE IS ADVISORY AND MUST STAY THAT WAY. Callers render the
// message; no caller may refuse a save because of it. Two reasons, and both
// have bitten this product before:
//   • the admin is often typing what a family actually gave them, and a number
//     we don't recognise is still the only number they have;
//   • a validator that blocks is a validator that has to be right about every
//     foreign number, every new prefix and every way a person writes one.
// The phone stays REQUIRED where it already was (a required field is a product
// decision); its SHAPE is never a precondition of submit.
//
// ⚠ THIS IS A STRICTER BAR THAN THE DATABASE'S, ON PURPOSE. SQL
// `normalize_phone()` takes the right-most 8 digits of anything carrying 8 or
// more, so `12345678` matches happily and a 12-digit string matches on its
// tail. That is the right rule for MATCHING — it must never reject a number it
// could otherwise pair up. This is the right rule for WARNING: it tells the
// admin when what they typed is unlikely to be what they meant. Do not
// "reconcile" the two by loosening this one; they answer different questions.
//
// The numbering plan (IMDA): every Singapore number is 8 digits. Leading 6 is
// PSTN/landline, 8 and 9 are mobile, 3 is VoIP. Optionally written +65.

export type ContactCheck = {
  /** `ok` renders nothing. `note` is advice. `warn` says this probably won't work. */
  level: "ok" | "note" | "warn";
  message?: string;
};

const OK: ContactCheck = { level: "ok" };

/**
 * Digits only, with an international prefix removed.
 *
 * ⚠ THE `65` STRIP IS LENGTH-GATED, AND MUST BE. `6512 3456` is a perfectly
 * ordinary Singapore landline that happens to start with the country code —
 * stripping unconditionally would turn it into the 6-digit `123456` and warn
 * about a number that is fine.
 */
export function normalizeSgPhone(input: string | null | undefined): string {
  let digits = (input ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("65")) digits = digits.slice(2);
  return digits;
}

/**
 * What to tell the admin about a phone number. Never blocks — see the header.
 *
 * An empty value is `ok` with no message: clearing a number the business never
 * had is a legitimate correction, not an error.
 */
export function checkSgPhone(input: string | null | undefined): ContactCheck {
  if (!(input ?? "").trim()) return OK;

  const digits = normalizeSgPhone(input);

  // Named separately from "wrong length" because the consequence is different
  // and worth saying out loud: below 8 digits normalize_phone() returns NULL,
  // so this is not a number that matches badly — it is a number that cannot
  // participate in matching at all. This is the `964` on production.
  if (digits.length < 8) {
    return {
      level: "warn",
      message:
        "Too short to be a phone number — this cannot be used to match the family to their account.",
    };
  }

  if (digits.length > 8) {
    return {
      level: "warn",
      message: `Singapore numbers are 8 digits — this has ${digits.length}. Check it before saving.`,
    };
  }

  if (/^[89]/.test(digits)) return OK;

  if (/^[36]/.test(digits)) {
    return {
      level: "note",
      message:
        "That looks like a landline or office number. A mobile is usually the better way to reach a family.",
    };
  }

  return {
    level: "warn",
    message:
      "That does not look like a Singapore number — they start with 6, 8 or 9.",
  };
}

/**
 * The lightest possible check on an email address: something, an @, something
 * with a dot. Deliberately not an RFC-shaped regex — the goal is catching a
 * missing @ or a trailing comma, not adjudicating what an address may contain.
 */
export function checkEmail(input: string | null | undefined): ContactCheck {
  const value = (input ?? "").trim();
  if (!value) return OK;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return OK;
  return {
    level: "warn",
    message: "That does not look like an email address.",
  };
}

/**
 * Trim, and turn an empty result into NULL.
 *
 * ⚠ USE THIS FOR EVERY CONTACT FIELD WRITTEN FROM THE ADMIN. The creation path
 * stores `NULLIF(trim(...), '')` (add_unclaimed_student, 20260725000200), so a
 * screen that writes `''` instead produces rows that differ from every row the
 * rest of the product made — and `''` is a value the matcher's NULL guards do
 * not catch the way they catch NULL.
 */
export function blankToNull(input: string | null | undefined): string | null {
  const value = (input ?? "").trim();
  return value === "" ? null : value;
}
