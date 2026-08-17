// ⚠ RISK 9 (docs/plans/CREDIT_NOTE_EMAIL_PLAN.md) — the credit-note email request
// must be HELD by the save path, not fired into an unmounting screen.
//
// PROVEN RED: replacing the awaited notifyCreditNoteEmails call with a
// fire-and-forget `.catch(() => {})` makes "resolves only once the invoke settles"
// pass vacuously but "does not resolve before the invoke settles" fail — that second
// test is the one that pins the ordering, and it is why both exist.

import {
  CREDIT_NOTE_EMAIL_TIMEOUT_MS,
  mayHaveIssuedCreditNote,
  notifyCreditNoteEmails,
} from "./creditNoteEmail";

/** A client whose invoke resolves only when the test says so. */
function deferredClient() {
  let release: (v?: unknown) => void = () => {};
  const calls: { name: string; body: unknown }[] = [];
  const client = {
    functions: {
      invoke: (name: string, opts: { body: unknown }) => {
        calls.push({ name, body: opts.body });
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
  };
  return { client, calls, release: () => release() };
}

// notifyCreditNoteEmails reaches `invoke` inside a microtask, so `release` is not
// captured until that has run. Tests that release immediately must drain first —
// otherwise they release the no-op default and hang for the full jest timeout,
// which is what the first draft of this file did.
async function drainMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("notifyCreditNoteEmails", () => {
  it("calls credit-note-emails with the lesson session id", async () => {
    const calls: { name: string; body: unknown }[] = [];
    const client = {
      functions: {
        invoke: (name: string, opts: { body: unknown }) => {
          calls.push({ name, body: opts.body });
          return Promise.resolve({ data: { sent: 1 } });
        },
      },
    };

    await notifyCreditNoteEmails(client, "d0000000-0000-0000-0000-000000000003");

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("credit-note-emails");
    expect(calls[0].body).toEqual({
      lesson_session_id: "d0000000-0000-0000-0000-000000000003",
    });
  });

  // The ordering assertion. If this passes with a fire-and-forget implementation,
  // the mitigation is gone.
  it("⚠ RISK 9: does NOT resolve before the invoke settles", async () => {
    const { client, release } = deferredClient();
    let settled = false;

    const pending = notifyCreditNoteEmails(client, "session-1", 10_000).then(() => {
      settled = true;
    });

    // Let every already-queued microtask drain. A fire-and-forget implementation
    // resolves here; an awaiting one does not.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await pending;
    expect(settled).toBe(true);
  });

  it("resolves once the invoke settles, without waiting out the timeout", async () => {
    const { client, release } = deferredClient();
    const pending = notifyCreditNoteEmails(client, "session-1", 60_000);
    await drainMicrotasks();
    release();
    // Would hang for 60s if the race were not honouring the invoke's resolution.
    await expect(pending).resolves.toBeUndefined();
  });

  // The save must complete even when the backend is unreachable. This is the whole
  // reason the request is bounded rather than simply awaited.
  it("⚠ RISK 9: gives up after the timeout rather than blocking the save", async () => {
    jest.useFakeTimers();
    try {
      const { client } = deferredClient(); // never released
      let settled = false;
      const pending = notifyCreditNoteEmails(client, "session-1", 3000).then(() => {
        settled = true;
      });

      await Promise.resolve();
      expect(settled).toBe(false);

      jest.advanceTimersByTime(3000);
      await pending;
      expect(settled).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("swallows a rejected invoke — a failed email never fails the save", async () => {
    const client = {
      functions: {
        invoke: () => Promise.reject(new Error("network down")),
      },
    };
    await expect(
      notifyCreditNoteEmails(client, "session-1"),
    ).resolves.toBeUndefined();
  });

  it("swallows a synchronous throw from invoke", async () => {
    const client = {
      functions: {
        invoke: () => {
          throw new Error("client exploded");
        },
      },
    };
    await expect(
      notifyCreditNoteEmails(client, "session-1"),
    ).resolves.toBeUndefined();
  });

  // Measures the PROPERTY (nothing left pending), not the mechanism. Spying on
  // clearTimeout only proved *someone* called it — under fake timers the spy sees
  // every call in the process, and the assertion never checked the argument, so it
  // was one unrelated internal call away from being permanently green.
  it("leaves no pending timer once the invoke settles", async () => {
    jest.useFakeTimers();
    try {
      const { client, release } = deferredClient();
      const pending = notifyCreditNoteEmails(client, "session-1", 3000);
      await drainMicrotasks();
      expect(jest.getTimerCount()).toBe(1);
      release();
      await pending;
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("defaults to a 3s bound", () => {
    expect(CREDIT_NOTE_EMAIL_TIMEOUT_MS).toBe(3000);
  });
});

// The guard that keeps the COMMON save free. Without it the coach waits on an edge
// function cold start after every attendance save, to be told there was nothing to do.
describe("mayHaveIssuedCreditNote", () => {
  it("true when a student leaves present for a non-billable status", () => {
    expect(mayHaveIssuedCreditNote({ s1: "present" }, { s1: "absent" })).toBe(true);
    expect(mayHaveIssuedCreditNote({ s1: "present" }, { s1: "cancelled_rain" })).toBe(true);
    expect(mayHaveIssuedCreditNote({ s1: "present" }, { s1: "cancelled_coach" })).toBe(true);
    expect(mayHaveIssuedCreditNote({ s1: "present" }, { s1: "trial_free" })).toBe(true);
  });

  it("true when a PAID TRIAL becomes non-billable — trial_paid is billable too", () => {
    expect(mayHaveIssuedCreditNote({ s1: "trial_paid" }, { s1: "absent" })).toBe(true);
  });

  // The trigger's own carve-out: no note within the same billing category.
  it("false for a move BETWEEN billable statuses", () => {
    expect(mayHaveIssuedCreditNote({ s1: "present" }, { s1: "trial_paid" })).toBe(false);
    expect(mayHaveIssuedCreditNote({ s1: "trial_paid" }, { s1: "present" })).toBe(false);
  });

  it("false for the ordinary first-time mark — no previous status at all", () => {
    expect(mayHaveIssuedCreditNote({}, { s1: "present" })).toBe(false);
    expect(mayHaveIssuedCreditNote({ s1: null }, { s1: "absent" })).toBe(false);
  });

  it("false when nothing changed — the re-save case", () => {
    expect(
      mayHaveIssuedCreditNote(
        { s1: "present", s2: "absent" },
        { s1: "present", s2: "absent" }
      )
    ).toBe(false);
  });

  it("false when a non-billable status changes to another non-billable one", () => {
    expect(mayHaveIssuedCreditNote({ s1: "absent" }, { s1: "cancelled_rain" })).toBe(false);
  });

  it("true if ANY student in the lesson made the transition", () => {
    expect(
      mayHaveIssuedCreditNote(
        { s1: "present", s2: "present", s3: "absent" },
        { s1: "present", s2: "absent", s3: "absent" }
      )
    ).toBe(true);
  });

  // The rained-off lesson: every student flips at once.
  it("true for a whole lesson cancelled after invoicing", () => {
    expect(
      mayHaveIssuedCreditNote(
        { s1: "present", s2: "present", s3: "present" },
        { s1: "cancelled_rain", s2: "cancelled_rain", s3: "cancelled_rain" }
      )
    ).toBe(true);
  });

  it("ignores students absent from the save payload", () => {
    // A student dropped from the roster cannot produce a note on this save.
    expect(mayHaveIssuedCreditNote({ s1: "present" }, {})).toBe(false);
  });
});
