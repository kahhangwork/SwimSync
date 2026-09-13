// Unassigned page entity types (feature root).

export type Student = {
  id: string;
  full_name: string;
  parent_name: string;
};

export type Coach = {
  id: string;
  full_name: string;
};

export type ClassOption = {
  id: string;
  title: string;
  day_of_week: string;
  start_time: string;
  student_count: number;
};
