# Review the assembled walkthrough

Run this stage after assembly and successful presentation validation, before delivery. Its purpose is to catch gaps between what the author intended to teach and what the generated lesson actually introduces. Use the [learner criteria](writing.md#read-it-back-as-a-learner); do not invent step, line, or link quotas.

## Assign a bounded independent pass

When delegation is available and authorized, assign one reviewer who did not author the lesson. Give it the user's requested scope and relevant learning preferences, the skill root, and the artifact directory. Prefer fresh context where the harness supports it. Supply the finished artifact rather than the author's outline, quality claims, or a list of suspected defects. The reviewer can request captured context when needed.

Use a subagent within the current task; do not create another user task or regenerate the walkthrough for review. The reviewer should not delegate further, edit the lesson, recapture source, or run the target project's test suite. Keep the lesson stable while it reviews. Review notes may be written in the artifact directory.

If independent delegation is unavailable or disallowed, the author performs the same review as a distinct pass. Record that it was an author review, not an independent one. This fallback does not require stopping the task or installing another capability.

A suitable assignment is:

> Review the assembled walkthrough at ARTIFACT using SKILL_ROOT/references/review.md and the writing guide's learner criteria. Check the actual lesson and captured source, not its authoring plan. Read all assembled prose and inspect the incremental edits for teaching gaps. Return concrete findings with step IDs, source evidence, reader impact, and a suggested correction. Record coverage and limitations in ARTIFACT/review-notes.md. Do not edit the lesson or start another review or generation.

## Inspect what the reader receives

From the skill root:

```sh
node scripts/review.mjs ARTIFACT
node scripts/review.mjs ARTIFACT --step STEP_ID
node scripts/review.mjs ARTIFACT --step STEP_ID --all
```

Read every step's assembled prose, including source-link labels and transitions. Inspect each construction step's actual incremental edits enough to identify the consequential operations introduced there and match them to their explanations. Start with unfamiliar calculations, ownership changes, test mechanisms, and large or scattered edits, then cover the remaining construction sequence. For long lessons, work in chapter batches and track coverage rather than repeatedly rereading the whole lesson.

Use the selected-step report to see changes against the preceding cumulative state. If its truncation hides an operation under review, use `--all` or read that step's reconstructed source. Resolve evidence against the captured version named by the pointer; do not substitute today's checkout or the final file for an intermediate state. Inspect tests' setup, action, and assertions before accepting a claim about what they establish.

Routine repeated declarations and serialized records need not receive line-by-line commentary or exhaustive inspection. Check their role and meaningful differences. Spend deeper review on decisions the reader must understand. A review should expose missing teaching, incorrect claims, misplaced edits, unclear pointers, or broken progression; it is not a request to redesign the underlying project or demand stylistic rewrites without a reader benefit.

## Return evidence and coverage

Keep `ARTIFACT/review-notes.md` concise. Identify the reviewed lesson revision (for example, the SHA-256 of `lesson.json`), reviewer role, steps or chapters inspected, and any portions not examined deeply. Distinguish reading prose from inspecting edits. A tool invocation or passing validator is not evidence that all teaching was checked.

For each actionable finding, record the step ID, relevant file and operation or prose, why it impedes understanding, and the smallest useful correction. For example: “`open-session` introduces disposal, but only `close-session` explains it; move that addition to the latter snapshot and recheck their pointers.” Keep examples grounded in the actual lesson. Do not manufacture findings when none are supported; state the coverage and limitations instead.

## Correct and verify once

The author checks the findings against source and makes one focused correction pass. Repair cumulative snapshots when timing is wrong; adding a later explanation cannot undo an early unexplained implementation. Keep artifact-local authoring scripts consistent with the corrected lesson so reassembly cannot erase the fixes. Do not alter the capture to make the lesson pass.

Rerun `node scripts/validate.mjs ARTIFACT --presentation`. Recheck changed explanations, actual edits, neighboring transitions, and pointers whose intermediate source moved. Use the same reviewer for a bounded findings recheck when available; do not commission another full review. Record each finding's disposition and the final validation/recheck result in the notes, including a reason for any finding rejected after source inspection.

The normal budget is one review, one correction pass, and a targeted recheck. Repair concrete regressions caused by those corrections without restarting the entire cycle. If a material teaching problem remains or review coverage is incomplete under the available budget, state it in the delivery notes instead of claiming a complete teaching review. Never present an invalid artifact as validated.

Keep review notes outside `lesson.json` and the guide panel. Deliver the walkthrough normally; mention material unresolved limitations, not a self-awarded quality score or a long audit checklist.
