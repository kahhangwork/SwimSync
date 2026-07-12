// ─── Placeholder data for SwimSync frontend prototype ───────────────────────

export const PLACEHOLDER_PARENT = {
  id: "parent-1",
  name: "Sarah Tan",
  email: "sarah.tan@email.com",
  phone: "+65 9123 4567",
};

export const PLACEHOLDER_CHILDREN = [
  {
    id: "child-1",
    name: "Emma Tan",
    dob: "2017-04-12",
    gender: "Female",
    ability: "Beginner",
    notes: "Afraid of deep water",
    status: "Assigned", // Unassigned | Assigned | Inactive
    coach: "Coach Marcus Lim",
    classDay: "Saturday",
    classTime: "10:00 AM – 11:00 AM",
    classLocation: "Buona Vista Swimming Complex",
    outstandingAmount: 120,
    creditBalance: 20,
  },
  {
    id: "child-2",
    name: "Ethan Tan",
    dob: "2019-08-30",
    gender: "Male",
    ability: "Intermediate",
    notes: "",
    status: "Unassigned",
    coach: null,
    classDay: null,
    classTime: null,
    classLocation: null,
    outstandingAmount: 0,
    creditBalance: 0,
  },
];

export const PLACEHOLDER_ATTENDANCE = [
  { id: "att-1", date: "2026-03-01", status: "Present", lesson: "Lesson 9" },
  { id: "att-2", date: "2026-02-22", status: "Absent",  lesson: "Lesson 8" },
  { id: "att-3", date: "2026-02-15", status: "Present", lesson: "Lesson 7" },
  { id: "att-4", date: "2026-02-08", status: "Cancelled", lesson: "Lesson 6" },
  { id: "att-5", date: "2026-02-01", status: "Trial",   lesson: "Lesson 5" },
  { id: "att-6", date: "2026-01-25", status: "Present", lesson: "Lesson 4" },
  { id: "att-7", date: "2026-01-18", status: "Present", lesson: "Lesson 3" },
  { id: "att-8", date: "2026-01-11", status: "Absent",  lesson: "Lesson 2" },
];

export const PLACEHOLDER_INVOICES = [
  {
    id: "inv-001",
    month: "February 2026",
    gross: 160,
    creditApplied: 40,
    net: 120,
    status: "Outstanding", // Outstanding | Paid
    lineItems: [
      { date: "2026-02-22", description: "Lesson 8 — Absent",   amount: 0 },
      { date: "2026-02-15", description: "Lesson 7 — Present",  amount: 40 },
      { date: "2026-02-08", description: "Lesson 6 — Cancelled",amount: 0 },
      { date: "2026-02-01", description: "Lesson 5 — Trial",    amount: 40 },
    ],
    creditNotes: [
      { ref: "CN-2026-001", amount: 40, reason: "Lesson cancelled by coach — Feb 8" },
    ],
  },
  {
    id: "inv-002",
    month: "January 2026",
    gross: 160,
    creditApplied: 0,
    net: 160,
    status: "Paid",
    lineItems: [
      { date: "2026-01-25", description: "Lesson 4 — Present", amount: 40 },
      { date: "2026-01-18", description: "Lesson 3 — Present", amount: 40 },
      { date: "2026-01-11", description: "Lesson 2 — Absent",  amount: 0  },
      { date: "2026-01-04", description: "Lesson 1 — Present", amount: 40 },
    ],
    creditNotes: [],
  },
];

export const PLACEHOLDER_CREDIT_NOTES = [
  {
    id: "cn-001",
    ref: "CN-2026-001",
    amount: 40,
    reason: "Lesson cancelled by coach — 8 Feb 2026",
    status: "Applied",
    linkedInvoice: "inv-001",
    date: "2026-03-01",
  },
];

// ─── Coach placeholder data ───────────────────────────────────────────────────

export const PLACEHOLDER_COACH = {
  id: "coach-1",
  name: "Marcus Lim",
  email: "marcus.lim@swimsync.sg",
  phone: "+65 9876 5432",
  hasPayNowQR: true,
};

export const PLACEHOLDER_TODAY_CLASSES = [
  {
    id: "class-1",
    name: "Saturday Beginners",
    time: "10:00 AM – 11:00 AM",
    location: "Buona Vista Swimming Complex",
    studentCount: 4,
    nextAction: "Mark Attendance",
    isActive: true,
  },
  {
    id: "class-2",
    name: "Saturday Intermediates",
    time: "11:30 AM – 12:30 PM",
    location: "Buona Vista Swimming Complex",
    studentCount: 3,
    nextAction: "Upcoming",
    isActive: false,
  },
];

export const PLACEHOLDER_ALL_CLASSES = [
  {
    id: "class-1",
    name: "Saturday Beginners",
    day: "Saturday",
    time: "10:00 AM – 11:00 AM",
    location: "Buona Vista Swimming Complex",
    rate: 40,
    studentCount: 4,
  },
  {
    id: "class-2",
    name: "Saturday Intermediates",
    day: "Saturday",
    time: "11:30 AM – 12:30 PM",
    location: "Buona Vista Swimming Complex",
    rate: 50,
    studentCount: 3,
  },
  {
    id: "class-3",
    name: "Sunday Advanced",
    day: "Sunday",
    time: "9:00 AM – 10:00 AM",
    location: "Clementi Swimming Complex",
    rate: 60,
    studentCount: 2,
  },
];

export const PLACEHOLDER_ROSTER = [
  { id: "s-1", name: "Emma Tan",     status: "Present",   age: 9 },
  { id: "s-2", name: "Ryan Chua",    status: "Absent",    age: 8 },
  { id: "s-3", name: "Mei Lin Koh",  status: "Present",   age: 10 },
  { id: "s-4", name: "Jake Ng",      status: "Not Marked", age: 7 },
];
