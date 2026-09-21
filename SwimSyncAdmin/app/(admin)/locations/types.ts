export type Location = {
  id: string;
  name: string;
  address: string | null;
  notes: string | null;
  sort_order: number;
  /** Classes still ACTIVE at this location — what blocks removal. */
  active_class_count: number;
  /** Classes RETIRED here — shown so "used by 0" is honest when departed
   *  classes still hold it, and so removal reads as archive not erase. */
  retired_class_count: number;
};
