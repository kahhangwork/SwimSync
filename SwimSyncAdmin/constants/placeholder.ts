// ─── SwimSync Admin — Placeholder Data ───────────────────────────────────────

export const PLACEHOLDER_COACHES = [
  { id: "coach-1", name: "Marcus Lim",   email: "marcus@swimsync.sg",  phone: "+65 9876 5432", classes: 3, hasPayNowQR: true  },
  { id: "coach-2", name: "Priya Nair",   email: "priya@swimsync.sg",   phone: "+65 9123 0011", classes: 2, hasPayNowQR: true  },
  { id: "coach-3", name: "David Wong",   email: "david@swimsync.sg",   phone: "+65 8811 2233", classes: 1, hasPayNowQR: false },
];

export const PLACEHOLDER_CLASSES = [
  { id: "class-1", name: "Saturday Beginners",     coach: "Marcus Lim",  day: "Saturday", time: "10:00–11:00", location: "Buona Vista SC", rate: 40, students: 4 },
  { id: "class-2", name: "Saturday Intermediates", coach: "Marcus Lim",  day: "Saturday", time: "11:30–12:30", location: "Buona Vista SC", rate: 50, students: 3 },
  { id: "class-3", name: "Sunday Advanced",        coach: "Marcus Lim",  day: "Sunday",   time: "09:00–10:00", location: "Clementi SC",    rate: 60, students: 2 },
  { id: "class-4", name: "Tuesday Beginners",      coach: "Priya Nair",  day: "Tuesday",  time: "18:00–19:00", location: "Tampines SC",    rate: 40, students: 5 },
  { id: "class-5", name: "Thursday Intermediates", coach: "Priya Nair",  day: "Thursday", time: "18:00–19:00", location: "Tampines SC",    rate: 50, students: 4 },
  { id: "class-6", name: "Wednesday Beginners",    coach: "David Wong",  day: "Wednesday",time: "17:30–18:30", location: "Jurong East SC", rate: 40, students: 3 },
];

export const PLACEHOLDER_STUDENTS = [
  { id: "s-1",  name: "Emma Tan",      parent: "Sarah Tan",   age: 9,  ability: "Beginner",     status: "Assigned",   class: "Saturday Beginners",     coach: "Marcus Lim"  },
  { id: "s-2",  name: "Ethan Tan",     parent: "Sarah Tan",   age: 6,  ability: "Intermediate", status: "Unassigned", class: null,                      coach: null          },
  { id: "s-3",  name: "Ryan Chua",     parent: "David Chua",  age: 8,  ability: "Beginner",     status: "Assigned",   class: "Saturday Beginners",     coach: "Marcus Lim"  },
  { id: "s-4",  name: "Mei Lin Koh",   parent: "Linda Koh",   age: 10, ability: "Intermediate", status: "Assigned",   class: "Saturday Intermediates", coach: "Marcus Lim"  },
  { id: "s-5",  name: "Jake Ng",       parent: "Peter Ng",    age: 7,  ability: "Beginner",     status: "Assigned",   class: "Saturday Beginners",     coach: "Marcus Lim"  },
  { id: "s-6",  name: "Aisha Rahman",  parent: "Farah Rahman",age: 11, ability: "Advanced",     status: "Assigned",   class: "Sunday Advanced",        coach: "Marcus Lim"  },
  { id: "s-7",  name: "Lucas Goh",     parent: "Mike Goh",    age: 8,  ability: "Beginner",     status: "Unassigned", class: null,                      coach: null          },
  { id: "s-8",  name: "Sofia Park",    parent: "Jenny Park",  age: 9,  ability: "Beginner",     status: "Unassigned", class: null,                      coach: null          },
  { id: "s-9",  name: "Noah Lim",      parent: "Grace Lim",   age: 7,  ability: "Beginner",     status: "Assigned",   class: "Tuesday Beginners",      coach: "Priya Nair"  },
  { id: "s-10", name: "Chloe Tan",     parent: "Amy Tan",     age: 10, ability: "Intermediate", status: "Assigned",   class: "Thursday Intermediates", coach: "Priya Nair"  },
  { id: "s-11", name: "Zara Abdullah", parent: "Hana Abdullah",age: 8, ability: "Beginner",     status: "Unassigned", class: null,                      coach: null          },
  { id: "s-12", name: "Ben Seah",      parent: "Tom Seah",    age: 12, ability: "Advanced",     status: "Inactive",   class: null,                      coach: null          },
];

export const PLACEHOLDER_UNASSIGNED = PLACEHOLDER_STUDENTS.filter(
  (s) => s.status === "Unassigned"
);

export const PLACEHOLDER_ATTENDANCE = [
  { id: "a-1",  student: "Emma Tan",    class: "Saturday Beginners",     coach: "Marcus Lim", date: "2026-03-07", status: "Present"   },
  { id: "a-2",  student: "Ryan Chua",   class: "Saturday Beginners",     coach: "Marcus Lim", date: "2026-03-07", status: "Absent"    },
  { id: "a-3",  student: "Jake Ng",     class: "Saturday Beginners",     coach: "Marcus Lim", date: "2026-03-07", status: "Present"   },
  { id: "a-4",  student: "Mei Lin Koh", class: "Saturday Intermediates", coach: "Marcus Lim", date: "2026-03-07", status: "Present"   },
  { id: "a-5",  student: "Aisha Rahman",class: "Sunday Advanced",        coach: "Marcus Lim", date: "2026-03-01", status: "Cancelled" },
  { id: "a-6",  student: "Noah Lim",    class: "Tuesday Beginners",      coach: "Priya Nair", date: "2026-03-03", status: "Trial"     },
  { id: "a-7",  student: "Chloe Tan",   class: "Thursday Intermediates", coach: "Priya Nair", date: "2026-03-05", status: "Present"   },
  { id: "a-8",  student: "Emma Tan",    class: "Saturday Beginners",     coach: "Marcus Lim", date: "2026-02-28", status: "Present"   },
  { id: "a-9",  student: "Ryan Chua",   class: "Saturday Beginners",     coach: "Marcus Lim", date: "2026-02-28", status: "Cancelled" },
  { id: "a-10", student: "Jake Ng",     class: "Saturday Beginners",     coach: "Marcus Lim", date: "2026-02-28", status: "Absent"    },
];

export const PLACEHOLDER_INVOICES = [
  { id: "inv-001", student: "Emma Tan",    parent: "Sarah Tan",    coach: "Marcus Lim", month: "Feb 2026", gross: 160, credit: 40,  net: 120, status: "Outstanding" },
  { id: "inv-002", student: "Ryan Chua",   parent: "David Chua",   coach: "Marcus Lim", month: "Feb 2026", gross: 160, credit: 0,   net: 160, status: "Paid"        },
  { id: "inv-003", student: "Mei Lin Koh", parent: "Linda Koh",    coach: "Marcus Lim", month: "Feb 2026", gross: 200, credit: 50,  net: 150, status: "Outstanding" },
  { id: "inv-004", student: "Jake Ng",     parent: "Peter Ng",     coach: "Marcus Lim", month: "Feb 2026", gross: 160, credit: 0,   net: 160, status: "Paid"        },
  { id: "inv-005", student: "Noah Lim",    parent: "Grace Lim",    coach: "Priya Nair", month: "Feb 2026", gross: 120, credit: 0,   net: 120, status: "Outstanding" },
  { id: "inv-006", student: "Chloe Tan",   parent: "Amy Tan",      coach: "Priya Nair", month: "Feb 2026", gross: 200, credit: 0,   net: 200, status: "Paid"        },
  { id: "inv-007", student: "Emma Tan",    parent: "Sarah Tan",    coach: "Marcus Lim", month: "Jan 2026", gross: 160, credit: 0,   net: 160, status: "Paid"        },
  { id: "inv-008", student: "Ryan Chua",   parent: "David Chua",   coach: "Marcus Lim", month: "Jan 2026", gross: 160, credit: 0,   net: 160, status: "Paid"        },
];

export const PLACEHOLDER_CREDIT_NOTES = [
  { id: "cn-001", ref: "CN-2026-001", student: "Emma Tan",    parent: "Sarah Tan",  amount: 40, reason: "Lesson cancelled by coach — 8 Feb",  linkedInvoice: "inv-001", date: "2026-03-01", status: "Applied"  },
  { id: "cn-002", ref: "CN-2026-002", student: "Mei Lin Koh", parent: "Linda Koh",  amount: 50, reason: "Lesson cancelled by coach — 15 Feb", linkedInvoice: "inv-003", date: "2026-03-01", status: "Applied"  },
  { id: "cn-003", ref: "CN-2026-003", student: "Ryan Chua",   parent: "David Chua", amount: 40, reason: "Attendance corrected — 28 Feb",       linkedInvoice: "inv-002", date: "2026-03-05", status: "Pending"  },
];

export const DASHBOARD_METRICS = {
  totalStudents:      PLACEHOLDER_STUDENTS.length,
  unassignedCount:    PLACEHOLDER_STUDENTS.filter((s) => s.status === "Unassigned").length,
  outstandingInvoices:PLACEHOLDER_INVOICES.filter((i) => i.status === "Outstanding").length,
  totalCreditNotes:   PLACEHOLDER_CREDIT_NOTES.length,
  totalCoaches:       PLACEHOLDER_COACHES.length,
  totalClasses:       PLACEHOLDER_CLASSES.length,
};
