# Writing a useful code walkthrough

The reader should understand what changes, how it fits the code they already have, and why the design takes its shape. The viewer provides navigation and full source; the guide supplies the explanation.

## Start with behavior and context

State the concrete behavior first. Describe a real trigger and outcome when helpful: what the caller or user does, what happened before, and what happens after. Avoid opening with a list of new classes, test helpers, or abstractions whose purpose has not been established.

Show the existing entry point and flow before introducing the new pieces that alter it. The baseline step is an opportunity to establish that context, not an obligatory empty introduction. Link directly to the original implementation.

Keep the opening focused on that behavior and original code. Do not send the reader to a future regression test to understand the first sentence; introduce the test after the behavior it checks is clear.

Use examples grounded in the actual feature. Do not manufacture a deterministic toy scenario, fake requirement, or test-first story just to create a narrative. Tests can supply evidence and reveal edge cases; introduce them where they help explain the behavior. Follow test-first order only when it is relevant to the requested lesson.

## Build in a plausible human design order

Choose an order that makes each new piece understandable from what the reader has already seen. That order may differ from filenames, diff order, or commit history. Present it as a teaching sequence, not a reconstruction of the author's thoughts.

A useful progression often moves from existing behavior to a needed contract, its implementation, and its integration. Use only the stages that fit the change. An early class skeleton can establish responsibilities before method details; explicitly identify any deliberately incomplete stage and then complete it. The final implementation should build, and the lesson must finish at the exact captured head. Report a build as verified only when it has been checked.

One step should teach **one useful idea**, which may span several lines or files. Do not turn every line into a step. Conversely, do not cram several independent decisions into a single step merely to keep the lesson short.

For a large scope, group consecutive steps into chapters through their titles and transitions. Cover the entire requested change across those chapters. Supporting changes still need a clear role and their final captured state; an unexplained final dump of remaining files is not a complete walkthrough.

## Explain decisions with evidence

Ground rationale in the code, the supplied requirements, or explicit project constraints. When reasoning is inferred, phrase it as an effect or tradeoff of this design: “Keeping this here lets both callers share the rule.” Do not write invented history such as “The author realized…” without supporting evidence.

Do not assume the chosen implementation is best simply because it exists. Explain a plausible alternative when there is a real decision worth understanding, including what the chosen approach gains and gives up. Skip contrived alternatives that no reasonable implementation would use, and skip comparison sections when there is no meaningful tradeoff.

Introduce a future constraint at the moment it affects a choice. For example, if later steps add another implementation of a contract, explain that need when introducing the contract. Distinguish a requirement visible in the captured change from a speculative extension; do not attribute imagined future plans to the project.

For example, in a change that stores checkout receipts, a useful explanation could be: “A receipt needs to keep the prices that were charged. Keeping references to the live cart would let later cart edits change an old receipt. Copying the line items here gives the receipt stable values, at the cost of storing another copy. The next step uses those values to print the receipt.” Use this level of concrete cause and effect, not these particular facts, unless the source supports them.

## Tie prose to exact code

Put source-link objects directly into paragraph arrays next to the claims they support. Select `base`, `step`, or `head` deliberately. A statement about what the reader has built so far must point to that step's code, not silently jump to the finished file.

Use a focused location to orient the reader while preserving the full source file in the viewer. If a claim depends on a caller and a definition, link both where the relationship is explained. Keep links specific enough that following one answers the reader's immediate question.

Read the prose against the cumulative code state. Check that introduced names exist, the focused lines still match after earlier edits, and a claimed behavior is actually present at that stage. Validation catches structural mistakes; this reading catches misleading explanations.

## Keep the guide direct

Use concrete titles and short, connected paragraphs. Let each paragraph explain something the code alone makes harder to see: a responsibility, data flow, constraint, or consequence.

Prefer familiar verbs and name the actual values or objects involved. Explain unfamiliar terms when they first matter. After reading a paragraph, the reader should be able to say what the new code does and why it belongs here without translating an abstract slogan.

Do not add repeated editorial cards, subtitles, taglines, slogans, or formulaic takeaways. Avoid restating the same idea in a title, a subtitle, the first sentence, and a conclusion. The existing guide panel is the presentation structure; lesson prose does not need to invent another one.

Keep artifact mechanics out of the lesson: no reminders that this is a teaching reconstruction, counts of files adopted from head, or announcements that validation passed. Those belong in delivery notes if relevant. Do not pad steps with an audit of hypothetical edge cases or missing checks unrelated to the change. Explain a limitation when it affects the design or the behavior being taught.

Before delivery, check that the opening establishes behavior, the baseline establishes context, each step advances understanding, and the final state covers every changed file. Keep necessary limitations concrete and local to the affected claim.

Make a separate editing pass after technical validation. Remove sentences that merely restate code, prove that the author inspected it, or describe the walkthrough itself. Read titles and paragraphs in sequence: a reader should learn the feature's design without having to keep translating terms such as “policy” or “boundary” when “format the name” or “call the helper” would do.
