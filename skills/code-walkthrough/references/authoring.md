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

| Step field        | Contract                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | Stable, unique string identifying the step.                                                                                                   |
| `title`           | Short, concrete description of the idea taught.                                                                                               |
| `paragraphs`      | Array of paragraphs; each paragraph is an array of strings and source-link objects.                                                           |
| `file`            | Optional manifest-listed file target. Without changes, this file opens automatically; with changes, it provides an optional full-file target. |
| `focus`           | Optional `[start, end]` line range in the selected version of `file`. Use one-based lines.                                                    |
| `symbol`, `count` | Symbol-based focus and its line count, as an alternative to a fixed range. Resolve against the selected version and validate the result.      |
| `version`         | `"base"`, `"step"`, or `"head"` for `file`. Prefer writing it explicitly when specifying a file target.                                       |
| `changes`         | Optional map from manifest-listed paths to cumulative changes.                                                                                |

Choose the default presentation for the step's purpose:

- A step with nonempty `changes` opens an overview of **all of that step's edits**, with compact diffs for every changed file and region and a visible region index. This is the default for construction steps. It includes removals and non-text changes; paragraph links are not needed to reveal additional work.
- A step without changes and with `file` opens that full file. Give it a useful `focus` or `symbol`/`count` when explaining a particular location in existing code.
- A step without changes or `file` leaves the source area empty, even if the preceding step opened a file. Use this for an opening or other explanation with no clear source target. Optional paragraph links can still open source.

Omit `focus`, `symbol`, `count`, and `version` when there is no `file`. A specified file must exist in its selected version. If a step has both changes and a file target, the change overview still opens first; the target provides a full-file location for further inspection. A deletion can be explained with a `base` reference even after the current step has removed the file.

Versions mean:

- `base`: the captured baseline, unaffected by lesson changes.
- `step`: the cumulative source state at this step, including this step's changes.
- `head`: the captured endpoint, unaffected by lesson changes.

Use `step` for references to incremental construction. Use `base` for original behavior and `head` when deliberately discussing the completed implementation. A link to head is not evidence that an intermediate step already implements that behavior. The change overview always compares the previous cumulative state with the current one.

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
- `{ "use": "head" }` adopts that file's captured head state. Use it when a step teaches all remaining edits in a file, avoiding accidental whitespace or newline differences. Otherwise supply an intermediate `text` state and return to the file later.
- `null` removes the file from the cumulative state.
- Omission preserves the preceding state; it does not reset the file to baseline.

An added file is absent at baseline. A deleted file is absent at head. At the final step, **every changed file must exactly reach captured head**, even if it is supporting plumbing or belongs to an earlier chapter. A final paragraph that merely says the work is complete cannot replace the required changes.

Final text equality is byte-exact: line endings, a UTF-8 BOM, and the final newline count. Finishing with `use: "head"` also preserves file modes. During a partial `text` step, the current mode is retained; a newly introduced file uses its captured mode.

Class skeletons and other incomplete intermediate states are allowed when they make the design easier to learn. Say what is deliberately incomplete at that step. The final state must be the captured implementation; it must not retain teaching placeholders. Distinguish a successful lesson validation from a verified project build.

Write construction steps so their changes and explanation advance together. Group related edits only when they serve one useful idea, such as a helper call and the test of its visible behavior. An overview makes scattered edits discoverable; it does not make a whole-file implementation an appropriate single step. If initialization, an operation, and cleanup each need teaching, add and explain them across steps.

## Source links inside paragraphs

Links serve two useful purposes: precise pointers into the code being taught, and optional references to context, earlier work, or supporting evidence. Essential new code appears through the step's change overview, so the reader must not need to click a paragraph link to encounter part of the work. Links are structured objects mixed with prose, not Markdown links to a live checkout:

```json
[
  "The greeting is assembled by ",
  {
    "label": "`greet`",
    "path": "src/greet.ts",
    "start": 1,
    "end": 3,
    "version": "step"
  },
  "."
]
```

A source link requires `label` and `path`, with optional `start`, `end`, `symbol`, `count`, `version`, and `view`. Use exact line ranges or symbol-based locations. Line numbers are one-based and inclusive. A `symbol` is a literal substring that must match exactly one source line; `count` extends the target from that line. Do not combine line and symbol locations. Write the version explicitly for claims whose meaning depends on the stage.

Choose the link's presentation deliberately:

- Omit `view` or set it to `"file"` to open the full file at the cited location. Use this for supporting references, or to narrow a context step's broad initial focus to particular statements. The source version can be `base`, `step`, or `head`.
- Set `view` to `"changes"` to select code within the current step's change overview. This requires a path present in that step's `changes` and a location: `start` with optional `end`, or `symbol` with optional `count`. Its `version` must be `"step"` or omitted. The location must exist in the cumulative source after applying this step. A deleted file therefore needs an ordinary file reference to an available version.

For example, a step changing `src/greet.ts` can point directly at its new expression:

```json
[
  "The ",
  {
    "label": "`return` expression",
    "path": "src/greet.ts",
    "start": 2,
    "end": 2,
    "version": "step",
    "view": "changes"
  },
  " trims the name before inserting it into the greeting."
]
```

Overview links retain the surrounding changes and add any target context needed to show the cited lines. This also helps identify a diff chunk: if its default surrounding lines omit the method declaration, include that declaration in a focused target ending at the relevant edit. Keep the range small enough to serve the sentence. Do not link to an entire class merely to explain one assignment, or manufacture a change to an unchanged file to use an overview link.

Clicking a link replaces the active selection with its target; it does not nest a second highlight within the first. A visible range stays in place, while a target outside the viewport is brought into view. **Return to step** restores the authored default presentation and focus. Full source remains available for exploration. If an overview cannot display a pointer's source range, the viewer opens the captured full file at that range.

Large text comparisons use bounded work. Difficult spans may appear as coarse removal/addition blocks, with a notice, rather than an unavailable diff. Run `node scripts/validate.mjs ARTIFACT --presentation` to prepare comparisons with the viewer's shared engine and identify those steps before delivery; the server also runs this check when starting. Review reported steps for readability without changing the captured source. The preflight checks comparison preparation, not browser layout or the quality of the explanation.

Recheck locations whenever earlier cumulative changes move code. Link the implementation of a claim directly, not a vaguely related file. In a long view or one with several regions, precise pointers make the prose easier to follow even when the code is already part of the step. Explain relationships in the prose; an optional link to a definition or existing caller can provide more detail.

## Inline formatting

Paragraph strings and source-link labels support a small, safe set of inline Markdown forms:

| Form        | Example input                  | Use                                         |
| ----------- | ------------------------------ | ------------------------------------------- |
| Inline code | `` `displayName(name)` ``      | Identifiers, expressions, and short values. |
| Bold        | `**after trimming**`           | A short distinction that needs emphasis.    |
| Emphasis    | `*only the surrounding space*` | Occasional emphasis within a sentence.      |

Underscores are literal: `_cachedValue` stays intact, and backticks can style it as code. Put complete formatting delimiters within a single string or label; do not open a delimiter in one part and close it in another. Keep each paragraph as an array of strings and source-link objects. Use another paragraph for another idea.

This is inline formatting, not a general Markdown or HTML renderer. Do not use Markdown URL links, headings, lists, fenced code blocks, or HTML tags in the prose. Source navigation always uses the structured objects above. Formatting should clarify names and relationships without turning the guide into a collection of editorial cards.

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
      "paragraphs": [
        [
          "Calling `greet` with a name surrounded by spaces currently preserves those spaces. The ",
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
      "changes": {
        "src/greet.ts": { "use": "head" }
      },
      "paragraphs": [
        [
          "The ",
          {
            "label": "`return` expression",
            "path": "src/greet.ts",
            "start": 2,
            "end": 2,
            "version": "step",
            "view": "changes"
          },
          " now trims the name before interpolation. Every caller gets the same greeting behavior; spaces within the name remain."
        ]
      ]
    }
  ]
}
```

The opening leaves the source area empty; its reference opens the baseline on demand. The second step automatically shows the change, and its pointer selects the expression within that overview. The [bundled greeting example](../examples/greeting/lesson.json) extends this approach with repeated edits to the same file, related implementation and test changes, and pointers within a step that touches multiple files.

This is an authoring illustration, not a replacement for test-generated fixture artifacts. Run `node scripts/validate.mjs ARTIFACT` against the actual capture and lesson before delivery.
