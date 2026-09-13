// Parent Requests (claims) entity type (feature root).

export type Claim = {
  id: string;
  status: "pending" | "approved" | "declined" | "withdrawn";
  certainty: "confirmed" | "unsure";
  match_reason: string;
  created_at: string;
  decided_at: string | null;
  claimed_name: string;
  claimed_dob: string | null;
  student_id: string;
  student_name: string;
  student_dob: string | null;
  lessons: number;
  parent_id: string;
  parent_name: string;
  parent_email: string;
  parent_phone: string | null;
};
