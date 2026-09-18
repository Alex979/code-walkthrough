# Writing a useful code walkthrough

The reader should learn the change by watching it take shape from the code they already have. Pair each new piece of code with its explanation when it is introduced. Advancing through the lesson should give the complete picture without requiring any paragraph links.

## Start with behavior and context

State the concrete behavior first. Describe a real trigger and outcome when helpful: what the caller or user does, what happened before, and what happens after. Avoid opening with a list of new classes, test helpers, or abstractions whose purpose has not been established.

Establish the existing entry point and enough of its flow to understand the first edit. An opening that explains the problem may leave the source area empty, with optional links to original behavior. When a step examines a specific existing function, open that function automatically. Choose a source target only when it helps explain the idea being taught.

Keep the opening focused on that behavior and original code. Do not send the reader to a future regression test to understand the first sentence; introduce the test after the behavior it checks is clear.

When a concrete input helps, choose a small case supported by the captured code and carry it through the relevant steps. In the greeting example, `" Ada "` becomes `"Ada"` in the helper and then `"Hello, Ada!"` at the caller. This connects the two functions without requiring the reader to reconstruct their relationship. A hypothetical input is fine when identified as an illustration; do not present it as an observed run, invent a requirement, or modify the captured implementation to accommodate it. Tests can supply examples and reveal edge cases. Follow test-first order only when it fits the requested lesson.

## Build and explain together

Choose an order that makes each new piece understandable from what the reader has already seen. That order may differ from filenames, diff order, or commit history. Present it as a teaching sequence, not a reconstruction of the author's thoughts.

A useful progression often moves from existing behavior to a needed contract, its implementation, and its integration. Plan each construction step around three things: the edit being made now, why it is needed, and what the reader will see automatically. Use only the stages that fit the change. Revisit the same file as its responsibilities develop.

One step should make **one useful edit**, which may span several lines or files. For a feature that adds instance state, initialization, an operation, and cleanup, introduce those pieces across steps when each needs its own explanation. A related import and the method that uses it can belong together. Several assets receiving the same setting can also belong together when the viewer presents all of their changes. Split work that needs separate explanations or would bury the main idea in a long diff.

Use cumulative full-file `text` states to make those smaller edits. Preserve existing code and everything built in previous steps. Adopt `use: "head"` when the current step explains every remaining change in that file; it is not a shortcut for filling the file before teaching it. For example, if the next step explains cleanup, add the cleanup in that next step. Do not add it silently with initialization and then return to unchanged code to explain what already happened.

Intermediate states can be incomplete: a caller may not use a new helper yet, or a class may still need its operation. Say what remains to connect or implement where it helps understanding. Avoid invented temporary algorithms or requirements just to lengthen the lesson. The final state must match the captured implementation exactly. Report a project build as verified only when it has been checked.

Context-only steps are useful for an opening, a necessary explanation of existing code, or a brief final trace. Use them deliberately. The construction sequence should advance the implementation as it explains it; a series of tours through an already completed file does not recreate building the change.

For a large scope, group consecutive steps into chapters using the lesson's `chapters` field. Cover the entire requested change across those chapters. Supporting changes still need a clear role and their final captured state; an unexplained final dump of remaining files is not a complete walkthrough.

Let the required explanations determine the step count. Do not assign a chapter or delegated author a step budget that encourages bundling unrelated work. A convenient source slice or whole-file adoption is not a teaching boundary: introduce consequential state and operations when their purpose is taught, even if their declarations are near the top of the final file.

Tests follow the same principle. Teach the setup, action, and meaningful assertion for a new behavior or testing technique; group additional cases when they repeat that pattern. Ownership, rejected mutations, and deterministic execution are different mechanisms, even when they share a test file. “Also covers…” followed by several new behaviors is a reason to inspect the edit, not an explanation of those behaviors. Place checks near the behavior they establish when that makes the sequence easier to follow; this does not require test-first order.

Distinguish routine fixture wiring from a new testing mechanism. If a fixture bypasses framework initialization, injects private dependencies, or invokes a normally inaccessible entry point, explain how that makes the scenario work and point to the operation rather than its declarations. Check what the inputs and assertions can actually distinguish: a test name or assertion message is not proof of its stated guarantee. For example, matching output from a constant input may fail to expose an extra operation. Describe the evidence the test supplies without expanding it into a general claim.

## Make a chapter advance a concrete interaction

A chapter title organizes steps; its prose must connect them. Before drafting a substantial phase, identify what the reader has already built, what is still missing, and what the phase will add. Put that short explanation in the first relevant step, alongside its first edit. Do not require a separate introduction page or a recap of the entire lesson.

Choose one small, supported interaction or input that crosses the phase's important boundaries. Carry its identity or values through the places where the representation changes: a clicked object becomes an ID, an ID becomes a command, a command produces a result. Show those concrete values where they explain the connection. Merely mentioning the same feature in every step is not a continuing example; nor must every helper or asset repeat the example.

Order the edits around the capabilities the reader needs next. At a transition, explain the specific gap that motivates the next addition. A cancellation path and a success path may need different cleanup; teach the difference when it determines the code, using the same interaction. If the story needs to explain an operation later, introduce its implementation then rather than installing it early and returning for a tour. Change step boundaries or cumulative snapshots when prose alone cannot repair that mismatch.

These synthetic excerpts illustrate a connected sequence, not requirements for a real export feature:

**Disconnected inventory:** “Add export selection state. Implement the CSV serializer. Wire the download handler.”

**Opening with the first edit:** “The table already displays orders, but Export always includes every column. Let the user choose `Order` and `Total` for a smaller download. First store the dialog's chosen column keys separately from the table's visible columns, so cancelling the dialog leaves the table alone.”

**Continuing through the next edit:** “We have the chosen keys, but they do not yet produce a file's contents. Make the CSV builder read those keys in order. For order `42` with total `12.50`, `[Order, Total]` produces the header `Order,Total` and the row `42,12.50`.”

**Closing with an honest boundary:** “The download handler now passes the chosen keys to the builder and gives its output to the browser. Cancelling closes the dialog without downloading or changing the table. This completes the local export path; fetching additional pages of orders is still part of the next phase.”

The opening, bridge, and ending belong in ordinary step paragraphs. Use them where they resolve a real change of responsibility; avoid repeated “so far / next” formulas, status cards, and recap-only steps. At the phase's end, state the resulting capability and any consequential work still to connect. Distinguish an assembled input path from a working end-to-end feature when later steps supply playback, persistence, services, or configuration. Do not imply an incomplete intermediate state has been run.

## Explain the need before the mechanics

At a new design decision, establish the concrete problem before listing the fields, APIs, or helpers used to solve it. Then walk through the relevant operations in reading order. The reader should know why they need a piece of code when it appears. A step continuing an established operation can get straight to the next edit; do not force every paragraph into a problem/solution template.

These are synthetic writing examples, not source or requirements to insert into a real lesson:

**Implementation inventory:** “Add a snapshot array and store it in the receipt constructor. This separates the receipt from mutable cart state.”

**Teaching the decision:** “Editing the cart later must not change a receipt we already issued. Copy each item's name and charged price into the receipt when it is created. The receipt can then keep showing what was purchased, even after the cart changes.”

The second version gives the reader a reason to care about the copy before introducing its storage. It does not claim this was the original author's thought process.

**Compressed mechanics:** “Normalize the input and apply a truthiness-based fallback before interpolating the result.”

**Teaching the operations:** “Remove spaces from the beginning and end of the name. If nothing remains, use `"friend"`. Put that result into the greeting, so an all-space name produces `"Hello, friend!"`.”

Keep necessary technical names, but attach them to actions the reader can picture. Explain what a setting changes before supplying its enum name or numeric value. Preserve details that determine behavior; move through them one at a time instead of packing a parameter inventory into one sentence.

For unfamiliar or consequential mechanics, explain how the important statements produce the result, not only the method's purpose. A formula may need its units, the constraint each term enforces, and a small worked example with explicit assumptions. Explain what a tuning constant controls without inventing why its exact value was chosen. Precise pointers locate this explanation's evidence; they do not substitute for the explanation itself.

Choose depth from the reader's needs and the code's difficulty, not a fixed line count or the overall size of the PR. If a coherent edit is understandable with another short paragraph and a precise pointer, keep it together. Split it when distinct calculations, decisions, or state transitions each need their own explanation and can be introduced progressively. Keep routine plumbing concise; do not split every method, require numerical examples everywhere, or narrate each assignment. A large diff and an unfamiliar algorithm need not receive the same treatment.

## Ground decisions in evidence

Ground rationale in the code, the supplied requirements, or explicit project constraints. When reasoning is inferred, phrase it as an effect or tradeoff of this design: “Keeping this here lets both callers share the rule.” Do not write invented history such as “The author realized…” without supporting evidence.

Do not assume the chosen implementation is best simply because it exists. Explain a plausible alternative when there is a real decision worth understanding, including what the chosen approach gains and gives up. Skip contrived alternatives that no reasonable implementation would use, and skip comparison sections when there is no meaningful tradeoff.

Introduce a future constraint at the moment it affects a choice. For example, if later steps add another implementation of a contract, explain that need when introducing the contract. Distinguish a requirement visible in the captured change from a speculative extension; do not attribute imagined future plans to the project.

## Show the work and point to what the prose explains

The source presentation carries the work of the step. Every edit introduced there must be available through the step's own change presentation, including related files and separated regions. Paragraph links must not be the only way to discover an added method, another changed file, or a required part of the explanation. If the essential work is too scattered to follow comfortably, split the step.

Choose pointers by the claims in the prose, not by counting method names. Linking a method once does not locate the distinct operations explained in later sentences. For a paragraph about copying an input list, point to the copy and assignment. For a later paragraph about rejecting a missing input, point to that guard. A name in prose is enough for a tiny, already-visible edit; repeated mentions do not each need a link.

For example, if a method first cancels an old request, then starts another, and finally stores the response, a useful explanation can link “cancel the previous request,” “start the new request,” and “store the response” to those separate operations. A single link on the method name that highlights all three leaves the reader doing the same search as before. Keep the connecting explanation readable without clicking; the links locate its evidence.

For work introduced in the current step, use `view: "changes"` with a `step` source location. This keeps the reader in the change overview and highlights the cited code there. All essential changes remain present before any click; the pointer connects a sentence to its implementation. Give the target enough context to recognize the code. If an initialization edit would otherwise appear without its method declaration, start the target at that declaration and end at the relevant statements. The overview includes that context automatically. Do not stretch a target across unrelated methods or use a long target to justify an overloaded step.

For a context step that opens a class or function, an ordinary file link can narrow its broad initial focus to the specific statements being explained. An automatically highlighted class is still a large search area: a sentence about its copied list should identify that copy directly. A clicked pointer replaces the active selection; **Return to step** restores the authored starting view. Do not describe viewer controls in the lesson itself.

Use ordinary file links for optional references as well: an existing caller, a type definition, a previously built helper, or evidence behind a claim. Explain the relevant relationship in the paragraph so following the link adds detail. A pointer within the step and a reference elsewhere have different reading purposes, but neither should be the only way to discover essential work.

Select `base`, `step`, or `head` deliberately for targets and references. A statement about what the reader has built so far must refer to that step's source, not silently jump to the finished file. Keep optional links specific enough that following one answers a concrete question, while preserving the full file for exploration.

## Keep the guide direct

Use concrete titles and short, connected paragraphs. Let each paragraph explain something the code alone makes harder to see: a responsibility, data flow, constraint, or consequence.

Name the object and action instead of making the reader translate an architectural summary. “The controller retains orchestration ownership while delegating persistence” might simply mean “The controller asks the store to save the draft, then closes the editor.” Use the concrete explanation when that is what the code does. Technical terms are useful when they distinguish behavior, not as substitutes for describing it.

Select detail by what it helps the reader understand. Explain the consequence of a changed configuration value rather than merely reporting two numbers. Unchanged flags, serialized bookkeeping, and unrelated guards seldom need equal space with the main edit. Keep them in the automatically displayed diff; discuss them when they affect behavior, a design choice, or a meaningful limitation. If their significance is uncertain, do not invent a reason or imply verification. A walkthrough should account for the change without narrating every diff token.

Use inline backticks around identifiers, expressions, and short literal values, including inside source-link labels. A sentence such as “`displayName` trims the input before `greet` assembles the message” is easier to scan than a run of unstyled names. Use `**bold**` sparingly for an important distinction and `*emphasis*` when it helps the sentence. The viewer supports these inline forms in paragraph strings and link labels; it does not require or support full Markdown documents, arbitrary HTML, or Markdown URL links. Underscores stay literal, so names such as `_cachedValue` cannot accidentally become emphasis.

Do not add repeated editorial cards, subtitles, taglines, slogans, or formulaic takeaways. Avoid restating the same idea in a title, a subtitle, the first sentence, and a conclusion. The existing guide panel is the presentation structure; lesson prose does not need to invent another one.

Keep artifact mechanics out of the lesson: no reminders that this is a teaching reconstruction, counts of files adopted from head, or announcements that validation passed. Those belong in delivery notes if relevant. Do not pad steps with an audit of hypothetical edge cases or missing checks unrelated to the change. Explain a limitation when it affects the design or the behavior being taught.

## Read it back as a learner

Use these criteria during authoring and in the separate [review and correction stage](review.md) before delivery. The validator checks source locations and final state, not whether the explanation teaches well. A prose-only read-through cannot reveal operations silently introduced in the code.

From the skill root, use the read-only report to compare the two:

```sh
node scripts/review.mjs ARTIFACT
node scripts/review.mjs ARTIFACT --step STEP_ID
node scripts/review.mjs ARTIFACT --step STEP_ID --all
```

The overview reports edit sizes and regions; selected-step details pair prose and resolved pointers with the actual diff against the preceding cumulative state. Details are bounded by default; use `--all` or read the relevant captured source when truncation hides the operation under review. Start with large or scattered edits and unfamiliar calculations, then check the rest of the construction sequence. Size and pointer counts identify things to inspect, not things to optimize: a large repetitive fixture can be clear, while a small formula can need substantial explanation.

1. **Follow the build without links.** Start from the actual additions and removals: what new decisions, calculations, or state transitions must the reader understand here? Match each consequential operation to its explanation. If it is taught only in a later step, move the edit there; if several independent ideas arrive together, split them. If one coherent calculation is underexplained, deepen that explanation instead. Routine declarations and repeated setup need not each be narrated. Ask what the reader would still have to figure out unaided; a method-name inventory or an extra link does not answer that question.
2. **Match claims to code.** For each paragraph describing an operation, locate the exact statements in that step's cumulative source. If the reader would have to search a long selection, another region, or another file, add a precise pointer on the relevant phrase. Check copy, guard, call, and configuration claims separately; one whole-method link does not automatically cover them all. Verify each target's version and enough surrounding context to recognize it. Do not impose a link quota or link every identifier.
3. **Read the prose on its own.** Read each paragraph with its link labels in place, rather than checking those fragments separately. Replace sentences that need translation with concrete objects and actions, as in the examples above. Remove incidental facts that do not explain the behavior. Where data crosses files or layers, reuse a small supported example if it makes the connection easier to follow. Keep necessary limitations with the affected claim.
4. **Read across step and chapter boundaries.** Can the reader name the missing capability at the start, follow the example as its values or responsibilities change, and explain what has become possible at the end? Check whether each substantial transition motivates the next edit. Fix an unexplained jump in the build order, not just its wording. Check titles as well as prose: a step that prepares a resource must not claim the behavior supplied by a later guard or caller. Confirm that the ending does not claim integration supplied by a later chapter.

When authors work in parallel, review chapter joins and the actual edits in each contribution; fragment validation and an author's report of completion are not substitutes for reviewing the assembled lesson. Keep review records outside the reader's guide, as described in the review stage.
