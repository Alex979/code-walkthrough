# Maintenance instructions

This repository is both a portable skill and its reusable local viewer. Maintain the product here; individual walkthroughs author data and use the bundled viewer.

## Invariants

- Keep the GitHub-style repository tree, source tabs, guide, system dark mode, and fixed navigation consistent across lessons. Do not make per-lesson UI generation part of the workflow.
- Keep the Bun runtime dependency-free. Resolve package resources relative to the skill root so symlinked and copied installations work from other working directories.
- `viewer/src/types.ts` is the exact lesson and manifest contract. Update consumers, validation, and references together when changing it.
- Start lessons at the captured baseline; when it is empty, introduce the first file in the first step. Apply `step.changes` cumulatively: full-file `text`, captured `head`, or `null` deletion. Only manifest-listed paths are legal. At the end, every changed file must exactly match captured head, including additions and deletions.
- Keep links and focus ranges tied to the selected source version. Do not calculate intermediate line numbers from head or use live working-tree content to render an old capture.
- Preserve capture semantics: two-dot ranges compare endpoint trees; branch and triple-dot scopes use a merge base. PR identity comes from authenticated `gh`; source comes from the resolved local Git objects. Missing objects must produce actionable fetch instructions.
- Capture a complete requested scope and enough repository context for the full tree. Large lessons may use chapters, but must finish the whole captured change.
- Serve bundled assets on localhost only. Do not turn lesson serving into a build, dependency installation, or public-hosting operation.
- Generate artifacts outside the repository being taught, preferring harness task artifacts and then user cache. Do not change that repository to make capture or teaching easier.
- The repository root remains installable as a skill. Ship scripts, types, references, and bundled viewer assets together. Do not add automatic global installation or publication.
- Use synthetic fixtures and examples only. Never add private source code, private captures, or user-specific lesson artifacts to this repository.

## Writing changes

Preserve the writing guide's central approach: behavior first, existing context next, then incremental design in a plausible human order. One useful idea per step; source links support concrete claims. Explain a relevant constraint where it changes the design. Do not invent historical reasoning, force test-first storytelling, or add repetitive editorial cards and slogans.

## Fast checks

Run from the repository root:

```sh
bun run build
bun run test
```

For capture, schema, or validator changes, use a synthetic fixture to run capture followed by `bun scripts/validate.ts ARTIFACT`. Check both a complete valid lesson and relevant rejection cases: illegal paths, invalid source locations, or a final state that differs from head. For scope changes, exercise the affected scope and confirm its endpoints. Rebuild bundled assets after viewer changes.

For documentation-only changes, check links, commands, and schema examples against the current types and tools. Do not claim runtime checks passed unless they were actually run. Keep documentation focused on current behavior and invariants rather than file inventories or change logs.
