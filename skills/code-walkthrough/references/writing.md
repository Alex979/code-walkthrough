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

For a large scope, group consecutive steps into chapters through their titles and transitions. Cover the entire requested change across those chapters. Supporting changes still need a clear role and their final captured state; an unexplained final dump of remaining files is not a complete walkthrough.

## Explain the need before the mechanics

At a new design decision, establish the concrete problem before listing the fields, APIs, or helpers used to solve it. Then walk through the relevant operations in reading order. The reader should know why they need a piece of code when it appears. A step continuing an established operation can get straight to the next edit; do not force every paragraph into a problem/solution template.

These are synthetic writing examples, not source or requirements to insert into a real lesson:

**Implementation inventory:** “Add a snapshot array and store it in the receipt constructor. This separates the receipt from mutable cart state.”

**Teaching the decision:** “Editing the cart later must not change a receipt we already issued. Copy each item's name and charged price into the receipt when it is created. The receipt can then keep showing what was purchased, even after the cart changes.”

The second version gives the reader a reason to care about the copy before introducing its storage. It does not claim this was the original author's thought process.

**Compressed mechanics:** “Normalize the input and apply a truthiness-based fallback before interpolating the result.”

**Teaching the operations:** “Remove spaces from the beginning and end of the name. If nothing remains, use `"friend"`. Put that result into the greeting, so an all-space name produces `"Hello, friend!"`.”

Keep necessary technical names, but attach them to actions the reader can picture. Explain what a setting changes before supplying its enum name or numeric value. Preserve details that determine behavior; move through them one at a time instead of packing a parameter inventory into one sentence.

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

After validation, make an editorial pass over the actual lesson. The validator checks source locations and final state, not whether the explanation teaches well.

1. **Follow the build without links.** Does each construction step add the code it is explaining? Can the reader understand why that edit is needed from what has come before? Split large jumps, move explanations to the edit they belong to, and remove sentences that only inventory fields or restate the title.
2. **Match claims to code.** For each paragraph describing an operation, locate the exact statements in that step's cumulative source. If the reader would have to search a long selection, another region, or another file, add a precise pointer on the relevant phrase. Check copy, guard, call, and configuration claims separately; one whole-method link does not automatically cover them all. Verify each target's version and enough surrounding context to recognize it. Do not impose a link quota or link every identifier.
3. **Read the prose on its own.** Replace sentences that need translation with concrete objects and actions, as in the examples above. Remove incidental facts that do not explain the behavior. Where data crosses files or layers, reuse a small supported example if it makes the connection easier to follow. Keep necessary limitations with the affected claim.

Revise the lesson from this pass before delivery. Do not append the checklist, a self-review report, or repeated takeaway cards to the reader's guide.
