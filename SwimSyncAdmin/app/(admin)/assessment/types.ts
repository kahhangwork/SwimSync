export type ClassRow = {
  id: string;
  title: string;
  day_of_week: string;
  start_time: string;
  location: string | null;
  coach: string | null;
  assessed: number;
  total: number;
  blocked: number;
};
