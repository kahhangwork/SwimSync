import React from "react";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { Button } from "@/components/Button";
import type { LevelsState } from "../domain/useLevels";

export function LevelsTable(p: { l: LevelsState }) {
  return (
    <>
      {p.l.loading ? (
        <p className="text-body text-ink-muted">Loading…</p>
      ) : p.l.levels.length === 0 ? (
        <div className="rounded-control border border-border bg-surface p-8 text-center">
          <p className="font-medium text-ink">No levels yet</p>
          <p className="mt-1 text-body text-ink-muted">
            Add the rungs you actually use — &ldquo;Seahorse&rdquo;,
            &ldquo;SwimSafer Level 1&rdquo;, whatever your business calls them.
            Until then a child&rsquo;s class name is the only signal of their level.
          </p>
        </div>
      ) : (
        <Table>
          {/* No <Tr> here — Thead emits its own. Wrapping these in one
              renders <tr> inside <tr>, which collapses all five headers into a
              single cell in column 1 and pushes every column out of line with
              the header naming it. Enforced by components/Table.test.tsx. */}
          <Thead>
            <Th sort={p.l.sort} sortKey="sort_order">Order</Th>
            <Th sort={p.l.sort} sortKey="label">Level</Th>
            <Th sort={p.l.sort} sortKey="skills">Skills</Th>
            <Th sort={p.l.sort} sortKey="student_count">Students</Th>
            <Th>Actions</Th>
          </Thead>
          <Tbody>
            {p.l.visible.map((l, li) => (
              <React.Fragment key={l.id}>
                <Tr>
                  <Td className="text-ink-muted">{l.sort_order}</Td>
                  <Td className="font-medium text-ink">
                    {l.label}
                    {l.note && (
                      <div className="mt-0.5 text-label font-normal italic text-ink-muted">
                        {l.note}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <button
                      onClick={() =>
                        p.l.setExpanded(p.l.expanded === l.id ? null : l.id)
                      }
                      className="text-body font-medium text-primary hover:underline"
                    >
                      {l.skills.length === 0
                        ? "Add skills"
                        : `${l.skills.length} skill${
                            l.skills.length === 1 ? "" : "s"
                          }`}
                      {p.l.expanded === l.id ? " \u25be" : " \u25b8"}
                    </button>
                  </Td>
                  <Td className="text-ink-muted">
                    {/* The number is ACTIVE children. A level can read 0 while
                        departed children still hold it, and the Remove dialog
                        will then say so — this title closes that gap on the page
                        itself, so the two numbers never look like they disagree.
                        On a <span> rather than a `title` prop on <Td>: widening
                        a shared table primitive for one cell's tooltip would put
                        the prop on all 22 tables. */}
                    <span
                      title={
                        l.inactive_count > 0
                          ? `${l.student_count} active. ${l.inactive_count} former student${
                              l.inactive_count === 1 ? "" : "s"
                            } still on this level.`
                          : undefined
                      }
                    >
                      {l.student_count}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => p.l.openEdit(l)}>
                        Edit
                      </Button>
                      <Button variant="outline" onClick={() => { p.l.setRemoveError(null); p.l.setRemoving(l); }}>
                        Remove
                      </Button>
                    </div>
                  </Td>
                </Tr>

                {p.l.expanded === l.id && (
                  <Tr>
                    <Td colSpan={5} className="bg-ground">
                      <div className="py-2">
                        <p className="mb-2 text-label text-ink-muted">
                          What is taught at this level, in teaching order. The
                          coach and the child&rsquo;s parent both see this.
                        </p>

                        {l.skills.length === 0 ? (
                          <p className="mb-3 text-body text-ink-muted">
                            No skills listed yet.
                          </p>
                        ) : (
                          <ol className="mb-3 space-y-1">
                            {l.skills.map((sk, i) => (
                              <li
                                key={sk.id}
                                className="flex items-center gap-2 text-body text-ink"
                              >
                                <span className="w-5 text-right text-ink-muted">
                                  {i + 1}.
                                </span>
                                <span className="flex-1">{sk.label}</span>
                                <button
                                  onClick={() => p.l.moveSkill(l, i, -1)}
                                  disabled={i === 0 || p.l.skillBusy}
                                  className="px-1 text-ink-muted hover:text-ink-secondary disabled:opacity-30"
                                  aria-label="Move up"
                                >
                                  &uarr;
                                </button>
                                <button
                                  onClick={() => p.l.moveSkill(l, i, 1)}
                                  disabled={i === l.skills.length - 1 || p.l.skillBusy}
                                  className="px-1 text-ink-muted hover:text-ink-secondary disabled:opacity-30"
                                  aria-label="Move down"
                                >
                                  &darr;
                                </button>
                                <button
                                  onClick={() => p.l.removeSkill(sk)}
                                  disabled={p.l.skillBusy}
                                  className="px-1 text-ink-muted hover:text-status-danger-text disabled:opacity-30"
                                  aria-label="Remove skill"
                                >
                                  &times;
                                </button>
                              </li>
                            ))}
                          </ol>
                        )}

                        <div className="flex gap-2">
                          <input
                            value={p.l.expanded === l.id ? p.l.newSkill : ""}
                            onChange={(e) => p.l.setNewSkill(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") p.l.addSkill(l);
                            }}
                            placeholder="Aeroplane Kick"
                            className="flex-1 rounded-control border border-border-strong px-3 py-1.5 text-body"
                          />
                          <Button
                            onClick={() => p.l.addSkill(l)}
                            disabled={p.l.skillBusy || !p.l.newSkill.trim()}
                          >
                            Add skill
                          </Button>
                        </div>
                        {p.l.skillError && (
                          <p className="mt-2 text-body text-status-danger-text">{p.l.skillError}</p>
                        )}
                      </div>
                    </Td>
                  </Tr>
                )}
              </React.Fragment>
            ))}
          </Tbody>
        </Table>
      )}
    </>
  );
}
