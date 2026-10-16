// A child's gender as the admin records it — Male / Female, the same two options as the parent app
// (SwimSyncApp/features/add-child/constants.ts). The DB enum's "other" is offered on neither side.
// Required and never pre-selected: "" in a form's state means "not chosen yet" (user, 2026-10-16).

export type Gender = "male" | "female";

export const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];
