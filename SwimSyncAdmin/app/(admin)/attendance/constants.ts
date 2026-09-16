export const STATUS_FILTERS = [
  "All","present","absent","cancelled_rain","cancelled_coach","trial_paid","trial_free","holiday",
];

export const STATUS_LABELS: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  cancelled_rain: "Cancelled (Rain)",
  cancelled_coach: "Cancelled (Coach)",
  trial_paid: "Trial (Paid)",
  trial_free: "Trial (Free)",
  holiday: "Public Holiday",
};

/**
 * The date range is what keeps this page bounded, so the cap is only a backstop
 * — but it is a visible one: when a load comes back full we say so, rather than
 * showing a truncated audit trail that looks complete.
 */
export const ROW_LIMIT = 1000;
