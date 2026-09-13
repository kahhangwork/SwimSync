// Coaches page entity type (feature root).

export type CoachRow = {
  id: string;
  profile_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  class_titles: string[];
  disabled_at: string | null;
};
