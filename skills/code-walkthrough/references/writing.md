# Writing a useful code walkthrough

The reader should learn the change by watching it take shape from the code they already have. Pair each new piece of code with its explanation when it is introduced. Advancing through the lesson should give the complete picture without requiring any paragraph links.

## Start with behavior and context

State the concrete behavior first. Describe a real trigger and outcome when helpful: what the caller or user does, what happened before, and what happens after. Avoid opening with a list of new classes, test helpers, or abstractions whose purpose has not been established.

Establish the existing entry point and enough of its flow to understand the first edit. An opening that explains the problem may leave the source area empty, with optional links to original behavior. When a step examines a specific existing function, open that function automatically. Choose a source target only when it helps explain the idea being taught.

Keep the opening focused on that behavior and original code. Do not send the reader to a future regression test to understand the first sentence; introduce the test after the behavior it checks is clear.

Use examples grounded in the actual feature. Do not manufacture a deterministic toy scenario, fake requirement, or test-first story just to create a narrative. Tests can supply evidence and reveal edge cases; introduce them where they help explain the behavior. Follow test-first order only when it is relevant to the requested lesson.

## Build and explain together

Choose an order that makes each new piece understandable from what the reader has already seen. That order may differ from filenames, diff order, or commit history. Present it as a teaching sequence, not a reconstruction of the author's thoughts.

A useful progression often moves from existing behavior to a needed contract, its implementation, and its integration. Plan each construction step around three things: the edit being made now, why it is needed, and what the reader will see automatically. Use only the stages that fit the change. Revisit the same file as its responsibilities develop.

One step should make **one useful edit**, which may span several lines or files. For a feature that adds instance state, initialization, an operation, and cleanup, introduce those pieces across steps when each needs its own explanation. A related import and the method that uses it can belong together. Several assets receiving the same setting can also belong together when the viewer presents all of their changes. Split work that needs separate explanations or would bury the main idea in a long diff.

Use cumulative full-file `text` states to make those smaller edits. Preserve existing code and everything built in previous steps. Adopt `use: "head"` when the current step explains every remaining change in that file; it is not a shortcut for filling the file before teaching it. For example, if the next step explains cleanup, add the cleanup in that next step. Do not add it silently with initialization and then return to unchanged code to explain what already happened.

Intermediate states can be incomplete: a caller may not use a new helper yet, or a class may still need its operation. Say what remains to connect or implement where it helps understanding. Avoid invented temporary algorithms or requirements just to lengthen the lesson. The final state must match the captured implementation exactly. Report a project build as verified only when it has been checked.

Context-only steps are useful for an opening, a necessary explanation of existing code, or a brief final trace. Use them deliberately. The construction sequence should advance the implementation as it explains it; a series of tours through an already completed file does not recreate building the change.

For a large scope, group consecutive steps into chapters through their titles and transitions. Cover the entire requested change across those chapters. Supporting changes still need a clear role and their final captured state; an unexplained final dump of remaining files is not a complete walkthrough.

## Explain decisions with evidence

Ground rationale in the code, the supplied requirements, or explicit project constraints. When reasoning is inferred, phrase it as an effect or tradeoff of this design: “Keeping this here lets both callers share the rule.” Do not write invented history such as “The author realized…” without supporting evidence.

Do not assume the chosen implementation is best simply because it exists. Explain a plausible alternative when there is a real decision worth understanding, including what the chosen approach gains and gives up. Skip contrived alternatives that no reasonable implementation would use, and skip comparison sections when there is no meaningful tradeoff.

Introduce a future constraint at the moment it affects a choice. For example, if later steps add another implementation of a contract, explain that need when introducing the contract. Distinguish a requirement visible in the captured change from a speculative extension; do not attribute imagined future plans to the project.

For example, in a change that stores checkout receipts, a useful explanation could be: “A receipt needs to keep the prices that were charged. Keeping references to the live cart would let later cart edits change an old receipt. Copying the line items here gives the receipt stable values, at the cost of storing another copy. The next step uses those values to print the receipt.” Use this level of concrete cause and effect, not these particular facts, unless the source supports them.

## Show the work and point to what the prose explains

The source presentation carries the work of the step. Every edit introduced there must be available through the step's own change presentation, including related files and separated regions. Paragraph links must not be the only way to discover an added method, another changed file, or a required part of the explanation. If the essential work is too scattered to follow comfortably, split the step.

Use precise source-link objects when a sentence would otherwise leave the reader scanning a large class or several diff regions. A name in prose is often enough for a tiny, already-visible edit. When a paragraph discusses a particular assignment, guard, or method in a larger view, make that name or phrase a pointer to the relevant lines. For example, a sentence about copying an input list should point at the copy and assignment, not highlight the entire class again.

For work introduced in the current step, use `view: "changes"` with a `step` source location. This keeps the reader in the change overview and highlights the cited code there. All essential changes remain present before any click; the pointer connects a sentence to its implementation. Give the target enough context to recognize the code. If an initialization edit would otherwise appear without its method declaration, start the target at that declaration and end at the relevant statements. The overview includes that context automatically. Do not stretch a target across unrelated methods or use a long target to justify an overloaded step.

For a context step that opens a class or function, an ordinary file link can narrow its broad initial focus to the specific statements being explained. A clicked pointer replaces the active selection; **Return to step** restores the authored starting view. There is no need to plan nested highlights or describe viewer controls in the lesson itself.

Use ordinary file links for optional references as well: an existing caller, a type definition, a previously built helper, or evidence behind a claim. Explain the relevant relationship in the paragraph so following the link adds detail. A pointer within the step and a reference elsewhere have different reading purposes, but neither should be the only way to discover essential work.

Select `base`, `step`, or `head` deliberately for targets and references. A statement about what the reader has built so far must refer to that step's source, not silently jump to the finished file. Keep optional links specific enough that following one answers a concrete question, while preserving the full file for exploration.

Read the prose against the cumulative code state. Check that introduced names exist, the focused lines still match after earlier edits, and a claimed behavior is actually present at that stage. Validation catches structural mistakes; this reading catches misleading explanations.

## Keep the guide direct

Use concrete titles and short, connected paragraphs. Let each paragraph explain something the code alone makes harder to see: a responsibility, data flow, constraint, or consequence.

Prefer familiar verbs and name the actual values or objects involved. Explain unfamiliar terms when they first matter. After reading a paragraph, the reader should be able to say what the new code does and why it belongs here without translating an abstract slogan.

Use inline backticks around identifiers, expressions, and short literal values, including inside source-link labels. A sentence such as “`displayName` trims the input before `greet` assembles the message” is easier to scan than a run of unstyled names. Use `**bold**` sparingly for an important distinction and `*emphasis*` when it helps the sentence. The viewer supports these inline forms in paragraph strings and link labels; it does not require or support full Markdown documents, arbitrary HTML, or Markdown URL links. Underscores stay literal, so names such as `_cachedValue` cannot accidentally become emphasis.

Do not add repeated editorial cards, subtitles, taglines, slogans, or formulaic takeaways. Avoid restating the same idea in a title, a subtitle, the first sentence, and a conclusion. The existing guide panel is the presentation structure; lesson prose does not need to invent another one.

Keep artifact mechanics out of the lesson: no reminders that this is a teaching reconstruction, counts of files adopted from head, or announcements that validation passed. Those belong in delivery notes if relevant. Do not pad steps with an audit of hypothetical edge cases or missing checks unrelated to the change. Explain a limitation when it affects the design or the behavior being taught.

Before delivery, read the lesson in order without following paragraph links. Check that the opening establishes behavior, that each construction step both adds and explains its work, and that the final state covers every changed file. Watch for code explained a step after it was introduced, essential edits visible only through links, and large jumps to a completed file. Repair those sequence problems by moving or splitting edits. Then check where precise pointers would help connect the explanation to code: useful pointers improve navigation without compensating for missing work. Keep necessary limitations concrete and local to the affected claim.

Make a separate editing pass after technical validation. Remove sentences that merely restate code, prove that the author inspected it, or describe the walkthrough itself. Read titles and paragraphs in sequence: a reader should learn the feature's design without having to keep translating terms such as “policy” or “boundary” when “format the name” or “call the helper” would do.
