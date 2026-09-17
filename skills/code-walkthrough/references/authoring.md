# Lesson authoring contract

Read this before writing `lesson.json`. The authoritative definitions live in [`scripts/types.ts`](../scripts/types.ts). Capture owns `manifest.json` and its blobs; authoring owns the lesson. Do not rewrite the capture to fit a narrative.

## Captured source

The manifest has `schemaVersion: 1`, repository and endpoint identities (`repo`, `base`, `head`), a `files` array, and optional `title`, `sourceUrl`, and `scope`. Each file has a `path`, a status (`"A"`, `"M"`, `"D"`, or `""`), and optional `base` and `head` blob descriptors.

A blob descriptor records `oid`, `size`, `kind`, and optional `mode`. Kinds are `text`, `binary`, `large`, and `unavailable`. Do not invent text for a blob that capture does not expose as text. Explain such changes using available evidence and preserve their captured state with `use: "head"` where applicable; do not promise a textual preview.

Text bytes live at `ARTIFACT/blobs/<oid>.txt`; base and head can share a blob. Read the descriptor for the intended version, then its file. Non-text descriptors have no text blob to read.

Unavailable working content can have an empty `oid` because its bytes were not read; do not invent a content identity. The capture records reasons in `scope.unavailable`. Explain any such limitation where it affects the lesson.

The manifest's paths define the allowed file universe for changes, step targets, and source links. Use their exact repository-relative spelling. Unchanged files provide context; they are not a reason to expand the requested change.

## Lesson and step fields

The lesson contains `schemaVersion: 1`, `title`, and `steps`. There is no separate `chapters` field. Express chapters through step titles and narrative progression while retaining one cumulative lesson.

| Step field        | Contract                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | Stable, unique string identifying the step.                                                                                              |
| `title`           | Short, concrete description of the idea taught.                                                                                          |
| `paragraphs`      | Array of paragraphs; each paragraph is an array of strings and source-link objects.                                                      |
| `file`            | Manifest-listed file to open for this step.                                                                                              |
| `focus`           | Optional `[start, end]` line range in the selected version. Use one-based lines.                                                         |
| `symbol`, `count` | Symbol-based focus and its line count, as an alternative to a fixed range. Resolve against the selected version and validate the result. |
| `version`         | `"base"`, `"step"`, or `"head"`. Prefer writing it explicitly.                                                                           |
| `changes`         | Optional map from manifest-listed paths to cumulative changes.                                                                           |

Give each step a useful focus with `focus` or `symbol`/`count`. Select a file that exists in that version. A deletion can be explained with a `base` link even after the current step has removed the file.

Versions mean:

- `base`: the captured baseline, unaffected by lesson changes.
- `step`: the cumulative source state at this step, including this step's changes.
- `head`: the captured endpoint, unaffected by lesson changes.

Use `step` to show incremental construction. Use `base` for original behavior and `head` when deliberately discussing the completed implementation. A link to head is not evidence that an intermediate step already implements that behavior.

## Cumulative changes

The initial step normally presents the captured baseline and has no changes. For a root commit or empty baseline, begin by introducing the first file and explain that the repository starts empty. Later steps inherit the preceding state and apply their `changes`:

```json
{
  "changes": {
    "src/message.ts": { "text": "export const message = 'Hello';\n" },
    "src/ready.ts": { "use": "head" },
    "src/obsolete.ts": null
  }
}
```

This is a shape example, not a complete lesson; all three paths must exist in that lesson's manifest.

- `{ "text": "..." }` replaces the whole file with the supplied text. It is not a patch or a snippet. Preserve all code that should still exist at that teaching stage.
- `{ "use": "head" }` adopts that file's captured head state. Prefer it when a step completes a file, avoiding accidental whitespace or newline differences.
- `null` removes the file from the cumulative state.
- Omission preserves the preceding state; it does not reset the file to baseline.

An added file is absent at baseline. A deleted file is absent at head. At the final step, **every changed file must exactly reach captured head**, even if it is supporting plumbing or belongs to an earlier chapter. A final paragraph that merely says the work is complete cannot replace the required changes.

Final text equality is byte-exact: line endings, a UTF-8 BOM, and the final newline count. Finishing with `use: "head"` also preserves file modes. During a partial `text` step, the current mode is retained; a newly introduced file uses its captured mode.

Class skeletons and other incomplete intermediate states are allowed when they make the design easier to learn. Say what is deliberately incomplete at that step. The final state must be the captured implementation; it must not retain teaching placeholders. Distinguish a successful lesson validation from a verified project build.

## Source links inside paragraphs

Links are structured objects mixed with prose, not Markdown links to a live checkout:

```json
[
  "The greeting is assembled by ",
  {
    "label": "greet",
    "path": "src/greet.ts",
    "start": 1,
    "end": 3,
    "version": "step"
  },
  "."
]
```

A source link requires `label` and `path`, with optional `start`, `end`, `symbol`, `count`, and `version`. Use exact line ranges or symbol-based locations. Write the version explicitly for claims whose meaning depends on the stage. Links open the full source file at the cited location; the lesson should not replace full code with cropped snippets.

Recheck locations whenever earlier cumulative changes move code. Link the implementation of a claim directly, not a vaguely related file. Explain relationships with separate links to the relevant definitions and callers when useful.

## Minimal synthetic lesson

This complete lesson assumes a synthetic capture with exactly one modified file, `src/greet.ts`. Its base text is:

```ts
export function greet(name: string): string {
  return `Hello, ${name}`;
}
```

Its head text is:

```ts
export function greet(name: string): string {
  return `Hello, ${name.trim()}`;
}
```

With that capture, the following lesson uses the exact contract and reaches head:

```json
{
  "schemaVersion": 1,
  "title": "Trim names when building a greeting",
  "steps": [
    {
      "id": "baseline",
      "title": "The greeting preserves surrounding spaces",
      "file": "src/greet.ts",
      "version": "base",
      "focus": [1, 3],
      "paragraphs": [
        [
          "Calling greet with a name surrounded by spaces currently preserves those spaces. The ",
          {
            "label": "return expression",
            "path": "src/greet.ts",
            "start": 2,
            "end": 2,
            "version": "base"
          },
          " inserts the supplied name directly. The change removes surrounding spaces in the greeting."
        ]
      ]
    },
    {
      "id": "trim-name",
      "title": "Trim the name where the greeting is assembled",
      "file": "src/greet.ts",
      "version": "step",
      "focus": [1, 3],
      "changes": {
        "src/greet.ts": { "use": "head" }
      },
      "paragraphs": [
        [
          "The ",
          {
            "label": "updated expression",
            "path": "src/greet.ts",
            "start": 2,
            "end": 2,
            "version": "step"
          },
          " trims the name before interpolation. Every caller gets the same greeting behavior; spaces within the name remain."
        ]
      ]
    }
  ]
}
```

This is an authoring illustration, not a replacement for test-generated fixture artifacts. Run `bun scripts/validate.ts ARTIFACT` against the actual capture and lesson before delivery.
