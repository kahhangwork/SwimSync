// Pure helpers for the parent's "Your referral code" card. Kept out of the
// component so the share text and reward copy are unit-testable and stable.
//
// Share + Copy are NEW capability (there is no Share import and no
// expo-clipboard in the app): Copy uses navigator.clipboard on web, Share uses
// a wa.me link — never React Native's Share.share (a no-op on RN-web) and never
// a new dependency for one button.

const WELCOME_URL = "https://swimsync.sg/welcome";

/** The WhatsApp/copy message a family forwards to a friend. */
export function buildReferralShareText(
  businessName: string,
  code: string,
): string {
  return (
    `Join me at ${businessName} on SwimSync! Use my referral code ${code} ` +
    `when you sign up and we both get a discount on our swim packages. ` +
    WELCOME_URL
  );
}

/** A wa.me deep link that pre-fills the share text. */
export function buildWhatsAppUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** "1 reward waiting…" / "3 rewards waiting…" / a nudge when there are none. */
export function rewardSummary(availableCount: number): string {
  if (availableCount <= 0) {
    return "Refer a friend to earn a discount on your next package.";
  }
  return availableCount === 1
    ? "1 reward waiting — a discount on your next package."
    : `${availableCount} rewards waiting — discounts on your next packages.`;
}
