import {
  describeCandidate,
  matchReasonLabel,
  isPendingOutcome,
  waitingSince,
  type ClaimCandidate,
} from "./claimCandidates";

const base: ClaimCandidate = {
  student_id: "s1",
  masked_name: "Ethan T. W. M.",
  match_reason: "name_only",
  last_lesson: "2026-07-11",
  class_title: "Saturday Beginners",
};

describe("describeCandidate", () => {
  it("names the class and the date a real parent can check", () => {
    expect(describeCandidate(base)).toBe(
      "Ethan T. W. M. — Saturday Beginners on Sat, 11 Jul"
    );
  });

  it("falls back to the date alone when the class is unknown", () => {
    expect(describeCandidate({ ...base, class_title: null })).toBe(
      "Ethan T. W. M. — last lesson Sat, 11 Jul"
    );
  });

  it("says so plainly when there is no lesson yet, rather than a dangling dash", () => {
    expect(
      describeCandidate({ ...base, last_lesson: null, class_title: null })
    ).toBe("Ethan T. W. M. — no lessons recorded yet");
  });

  // The guard that matters: this helper must never receive, or emit, a full
  // name. Masking is done in SQL so nothing here can leak one — if a future
  // change starts sending full names, this is the assertion that should be
  // updated only with a very good reason.
  it("emits exactly what the server sent, never a fuller name", () => {
    expect(describeCandidate(base)).toContain("Ethan T. W. M.");
    expect(describeCandidate(base)).not.toContain("Wei Ming");
  });
});

describe("matchReasonLabel", () => {
  it("explains a phone match WITHOUT echoing the number back", () => {
    const label = matchReasonLabel("phone");
    expect(label).toBe("This matches the contact number your coach has on file.");
    expect(label).not.toMatch(/\d/);
  });

  it("explains an email match without echoing the address back", () => {
    const label = matchReasonLabel("email");
    expect(label).toBe("This matches the email address your coach has on file.");
    expect(label).not.toContain("@");
  });

  it("distinguishes a full identity match from a name-only one", () => {
    expect(matchReasonLabel("name_dob")).toBe(
      "The name and date of birth both match."
    );
    expect(matchReasonLabel("name_only")).toBe("The name is similar.");
  });

  // The parent sees an ordinary name match. Telling them the number on file
  // differs would disclose another family's record to someone unapproved.
  it("does NOT reveal a phone discrepancy to the parent", () => {
    expect(matchReasonLabel("name_only_phone_differs")).toBe(
      matchReasonLabel("name_only")
    );
    expect(matchReasonLabel("name_only_phone_differs")).not.toMatch(
      /number|phone|differ/i
    );
  });

  it("degrades to something harmless for an unknown reason", () => {
    expect(matchReasonLabel("something_new")).toBe(
      "This may be the same child."
    );
  });
});

describe("isPendingOutcome", () => {
  it("treats a fresh claim and a re-submitted one alike — both are waiting", () => {
    expect(isPendingOutcome("pending")).toBe(true);
    expect(isPendingOutcome("already_pending")).toBe(true);
  });

  it("does not treat creation or a candidate list as pending", () => {
    expect(isPendingOutcome("created")).toBe(false);
    expect(isPendingOutcome("candidates")).toBe(false);
  });
});

describe("waitingSince", () => {
  it("reads the SGT calendar date off the timestamp", () => {
    expect(waitingSince("2026-07-26T01:15:00+08:00")).toBe(
      "Waiting since Sun, 26 Jul"
    );
  });
});
