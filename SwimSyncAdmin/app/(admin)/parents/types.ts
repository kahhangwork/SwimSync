// The Parents page's entity types (feature root, not lib/ — these are shaped by
// this page's queries and read by its domain/ mapping and ui/ surfaces).

export type Child = { id: string; full_name: string; is_active: boolean };

export type FamilyRow = {
  parent_id: string;
  tenant_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  inactivated_at: string | null;
  children: Child[];
};
