# WI-PRETRIAL-TRIAL-ADDON-01 — Frozen Feature Plan

We need to add the next major feature layer to the existing LawBar / Case Box product.

## Important premise

This is not a rebuild. Do not replace the existing matter, evidence, document, OCR, persistence, IPC, localization, or UI-shell architecture. The goal is to add a pre-trial preparation layer and a trial-mode evidence navigation layer on top of the existing product.

Existing evidence remains the source of truth. New preparation data must link to existing matter, evidence, and document records. Do not create a parallel evidence system.

Where this document conflicts with existing repo conventions, existing data structures, existing validation contracts, or existing persistence patterns, stop and surface the conflict rather than implementing either side literally.

Before implementing feature code, deliver an architecture assessment and schema/contract diff for approval. That assessment should identify the existing matter/evidence/document structures, the proposed additive extension points, and any conflicts with this specification.

## Feature objective

Add a litigation pre-trial preparation and trial courtroom navigation system.

The product should help lawyers:

1. Prepare claims or responses before trial.
2. Organize evidence purpose, facts to prove, cross-examination opinions, and legal opinions.
3. Support both plaintiff-side and defendant-side case preparation.
4. Support optional counterclaims in both directions.
5. During trial, quickly retrieve prepared legal opinions and the evidence supporting or opposing them.

The final product direction:

Pre-trial mode is for building the lawyer’s reasoning.

Trial mode is for retrieving and speaking that reasoning in court.

Core implementation principle:

```text
Claim / response
→ evidence purpose
→ cross-examination
→ legal opinion card
→ trial-mode retrieval
```

Do not replace the existing evidence workflow.

---

# 1. Claim-track model

Add the concept of a claim track.

A claim track represents either:

* the main claim; or
* a counterclaim.

Each claim track must know:

* who is the claimant;
* who is the respondent;
* whether our side is asserting the claim or responding to the claim.

Do not hardcode separate plaintiff and defendant workflows.

The correct abstraction is:

```text
ClaimTrack.our_role = asserting | responding
```

This must support:

Scenario A:

Our client is plaintiff and asserts the main claim.

Scenario B:

Our client is plaintiff and must respond to the defendant’s counterclaim.

Scenario C:

Our client is defendant and responds to the plaintiff’s main claim.

Scenario D:

Our client is defendant and asserts our own counterclaim.

Required claim-track fields:

* `id`
* `matter_id`
* `track_type`: `main_claim | counterclaim`
* `claimant_party_id`
* `respondent_party_id`
* `our_role`: `asserting | responding`
* `title`
* `claim_summary`
* `response_summary`
* `legal_basis`
* `calculation_summary`
* `status`
* `sort_order`

Define `ClaimTrack.status` as:

* `active`
* `withdrawn`
* `resolved`

Counterclaim cardinality:

The first UI version may expose only one counterclaim for simplicity, but do not enforce a schema-level maximum of one counterclaim. Multiple counterclaims or third-party claims may exist later. Keep the schema future-compatible.

All new models must include the project’s standard audit fields, such as `created_at`, `updated_at`, or equivalent fields, according to existing repo conventions.

---

# 2. Evidence preparation metadata

Add preparation metadata linked to existing evidence records.

Do not replace the existing evidence model.

Do not create new evidence IDs.

Use existing evidence IDs.

Each evidence item may have preparation information for one or more claim tracks.

Required evidence-preparation fields:

* `id`
* `matter_id`
* `claim_track_id`
* `evidence_id`
* `submitted_by_side`
* `evidence_purpose`
* `facts_to_prove`
* `trial_use_summary`
* `key_page`
* `key_page_note`
* `review_status`
* `sort_order`

`submitted_by_side` enum:

* `our_side`
* `opposing_side`
* `third_party`
* `court_obtained`
* `unknown`

If the existing evidence model already has an equivalent submitted-side field, read from the existing model and do not duplicate unnecessarily. If no equivalent exists, `EvidencePreparation.submitted_by_side` is authoritative for the preparation layer.

`facts_to_prove` should be an array of short strings, not a single prose blob. This preserves future migration compatibility with a later Fact model.

`review_status` enum:

* `draft`
* `in_review`
* `confirmed`

Uniqueness constraint:

`EvidencePreparation` should be unique on:

```text
(claim_track_id, evidence_id)
```

One evidence item may have preparation records on multiple claim tracks. This is how the system expresses that the same evidence is used for both the main claim and a counterclaim.

Inspector behavior when one evidence item has records on multiple claim tracks:

The inspector must show the preparation record for the currently selected claim-track context. If the evidence has preparation records on more than one track, show a visible track switcher.

Purpose:

Whenever a lawyer views evidence in the preparation or trial context, the product must show:

* what this evidence is;
* which claim track it belongs to;
* who submitted it;
* what it is intended to prove;
* what facts it supports;
* how it should be used in trial.

`key_page` and `key_page_note` are intentionally minimal. They are not a full evidence-anchor system. They simply allow the lawyer to record a useful page reference now, without implementing bounding boxes, OCR spans, or annotation anchors in this work item.

---

# 3. Cross-examination opinion model

Add structured cross-examination opinions linked to existing evidence records and claim tracks.

This model must support two directions:

1. Our objection to opposing evidence.
2. Their anticipated objection to our evidence, plus our prepared response.

Do not use an ambiguous `authored_by_side` field.

Required fields:

* `id`
* `matter_id`
* `claim_track_id`
* `evidence_id`
* `direction`
* `authenticity_status`
* `authenticity_reason`
* `legality_status`
* `legality_reason`
* `relevance_status`
* `relevance_reason`
* `probative_force_status`
* `probative_force_reason`
* `overall_opinion`
* `courtroom_short_version`
* `our_response_short_version`
* `preparation_status`

`direction` enum:

* `our_objection_to_their_evidence`
* `their_anticipated_objection_to_our_evidence`

`our_response_short_version` is required when:

```text
direction = their_anticipated_objection_to_our_evidence
```

Use structured enum values for authenticity, legality, relevance, and probative force.

Status enum:

* `admitted`
* `denied`
* `conditional`
* `reserved`
* `not_applicable`

The four required dimensions are:

1. Authenticity
2. Legality
3. Relevance
4. Probative force / evidentiary purpose

`preparation_status` enum:

* `draft`
* `review_needed`
* `ready_for_trial`

Use the same `preparation_status` enum for CrossExaminationOpinion and LegalOpinionCard because both can become courtroom speaking material.

Uniqueness constraint:

`CrossExaminationOpinion` should be unique on:

```text
(claim_track_id, evidence_id, direction)
```

Trial-mode display rule:

For opposing evidence, show our objection.

For our evidence, show anticipated objection plus our prepared response.

The trial-mode right pane should display cross-examination summaries regardless of the cross-examination opinion’s preparation status. Show the status badge clearly. A draft objection is still useful in court if that evidence unexpectedly becomes relevant.

Do not add `rebuttal_evidence_ids` to CrossExaminationOpinion in this work item. Rebuttal linkage must be expressed through a LegalOpinionCard:

* `stage = cross_examination`
* `opposing_evidence_ids` = evidence being attacked
* `supporting_evidence_ids` = rebuttal evidence

This avoids creating two competing places for evidence-to-evidence attack relationships.

---

# 4. Legal opinion cards

Add legal opinion cards.

This is the core object for trial mode.

A legal opinion card represents something the lawyer may need to say in court.

Examples:

* basis of claim;
* claim calculation method;
* evidence presentation;
* cross-examination opinion;
* fact-finding-stage opinion;
* debate-stage opinion;
* final statement point;
* prepared answer to likely judge question;
* prepared response to opposing party’s argument.

Required fields:

* `id`
* `matter_id`
* `claim_track_id`
* `stage`
* `trigger_type`
* `trigger_text: string | null`
* `title`
* `full_opinion_text`
* `courtroom_short_version`
* `supporting_evidence_ids`
* `opposing_evidence_ids`
* `preparation_status`
* `used_in_trial_at`
* `follow_up_flagged_at`
* `priority`
* `sort_order`

Important design rule:

Do not conflate trial stages with trigger types.

`stage` means where this card belongs in the hearing sequence.

Required `stage` enum:

* `claim_basis`
* `claim_calculation`
* `evidence_presentation`
* `cross_examination`
* `fact_finding`
* `debate`
* `final_statement`
* `any`

`judge_question` and `opponent_argument_response` must not be stages. They are trigger types.

Required `trigger_type` enum:

* `judge_question`
* `opposing_argument`
* `evidence_objection`
* `disputed_point`
* `planned_statement`
* `procedural_issue`
* `other`

`trigger_text` may be null. For example, a `planned_statement` card may not have a specific external trigger.

`stage = any` is allowed for legal opinion cards that are not tied to one specific hearing stage.

`claim_track_id` may be nullable:

* If `claim_track_id` is set, the card belongs to that claim track.
* If `claim_track_id` is null, the card is matter-level.

Legal opinion cards with `claim_track_id = null` are matter-level cards. They must appear under the “All tracks” view and must also remain visible when a specific claim-track filter is selected, because matter-level cards apply across all claim tracks.

Required `preparation_status` enum:

* `draft`
* `review_needed`
* `ready_for_trial`

Do not use `used_in_trial` or `needs_follow_up` as preparation statuses because they overwrite readiness information.

Instead use:

* `used_in_trial_at: timestamp | null`
* `follow_up_flagged_at: timestamp | null`

Trial-relevant cards are:

* `preparation_status = ready_for_trial`
* or `used_in_trial_at` is not null
* or `follow_up_flagged_at` is not null

`priority` must be an integer. Higher value means higher courtroom urgency.

`supporting_evidence_ids` and `opposing_evidence_ids` are ordered arrays. Their order is meaningful and must be preserved because evidence presentation order is part of the lawyer’s work product.

Legal opinion cards should link to:

* supporting evidence;
* opposing evidence to attack or distinguish;
* the relevant claim track or matter;
* eventually facts and disputed issues, but do not scaffold stub Fact or DisputedIssue models in this work item.

Do not add placeholder Fact or DisputedIssue models just to make future links look complete. Those belong in a later phase.

---

# 5. Pre-trial preparation view

Add a new pre-trial preparation feature surface or tab.

Do not replace the existing evidence screen.

The pre-trial view should have three conceptual regions:

Left:

Case-preparation navigation.

Center:

Working area.

Right:

Preparation inspector.

The first version can be visually simple. Correct information architecture matters more than visual polish.

The left navigation should expose:

* claim tracks;
* main claim;
* counterclaim, if present;
* evidence preparation;
* cross-examination;
* legal opinion cards.

The center working area should allow the lawyer to view and select:

* claim track;
* existing evidence;
* evidence-preparation metadata;
* cross-examination opinions;
* legal opinion cards.

The right inspector must change based on selection.

When evidence is selected, the inspector must always show:

* existing evidence label or number;
* evidence title;
* claim track;
* submitted side;
* evidence purpose;
* facts to prove;
* trial-use summary;
* key page;
* key page note;
* authenticity opinion;
* legality opinion;
* relevance opinion;
* probative-force opinion;
* overall cross-examination opinion;
* courtroom short version;
* if applicable, anticipated objection and our response;
* linked legal opinion cards.

If both cross-examination directions exist for the same evidence item, the inspector must show both records, each clearly labeled by direction:

* our objection to their evidence;
* their anticipated objection to our evidence, plus our prepared response.

Do not collapse the two records into one summary and do not silently prefer one direction over the other.

When a legal opinion card is selected, the inspector must show:

* stage;
* trigger type;
* trigger text;
* full opinion text;
* courtroom short version;
* supporting evidence;
* opposing evidence to attack;
* preparation status;
* used-in-trial marker, if any;
* follow-up marker, if any.

---

# 6. Trial mode

Add a trial mode view.

Trial mode is not a general editing screen. It is a courtroom retrieval interface.

The layout must be:

Left pane:

Legal opinion / speaking material.

Right pane:

Evidence navigation and evidence details.

This layout is intentional. During trial, lawyers usually need to answer:

```text
What should I say right now?
```

Then:

```text
Which evidence supports this?
```

So trial mode must start from prepared legal opinions, not from the evidence browser.

Trial mode left pane should:

* show legal opinion cards;
* group or filter by stage;
* filter by trigger type;
* filter by claim track;
* show title, stage, trigger, courtroom short version, and preparation status;
* default to trial-relevant cards only.

Trial-relevant cards are:

* `preparation_status = ready_for_trial`
* or `used_in_trial_at` is not null
* or `follow_up_flagged_at` is not null.

By default, trial mode should hide:

* `draft`
* `review_needed`

Legal opinion cards with `stage = any` must appear in a dedicated “General” group and must also match every specific stage filter. They must not disappear when the lawyer filters trial mode to a specific hearing stage.

Trial-mode ordering:

Within each stage group, sort deterministically by:

1. `priority` descending;
2. `sort_order` ascending;
3. `title` ascending.

Trial mode right pane should:

* update when a legal opinion card is selected;
* display supporting evidence from `supporting_evidence_ids`;
* display opposing evidence from `opposing_evidence_ids`;
* visually distinguish supporting evidence from opposing evidence;
* allow selecting an evidence item;
* show evidence detail;
* show evidence purpose;
* show facts to prove;
* show key page and key page note;
* show trial-use summary;
* show cross-examination summary.

Required interaction:

Selecting a legal opinion card on the left must update the evidence navigation panel on the right.

Selecting evidence on the right must update the evidence detail panel.

Trial mode must not force the lawyer to manually search from scratch if the selected legal opinion already links to evidence.

Permitted trial-mode writes:

Trial mode is mostly read-only.

Trial mode may permit exactly these writes:

1. Set `used_in_trial_at` on a legal opinion card.
2. Clear `used_in_trial_at` on a legal opinion card.
3. Set `follow_up_flagged_at` on a legal opinion card.
4. Clear `follow_up_flagged_at` on a legal opinion card.

Use the existing UI’s undo or confirmation pattern if available.

All other legal opinion fields are read-only in trial mode.

Do not allow heavy editing of preparation fields in trial mode.

---

# 7. IPC / query expectations

Follow the existing project’s IPC and persistence patterns, but the trial mode needs a non-chatty query surface.

Minimum required query behavior:

## 7.1 `listClaimTracks(matter_id)`

Returns claim tracks for the matter.

## 7.2 `getPreparation(matter_id, evidence_id)`

Returns, in one call:

* all evidence-preparation records for that evidence across claim tracks;
* all cross-examination opinions for that evidence across claim tracks;
* track labels needed by the inspector.

## 7.3 `listOpinionCards(matter_id, filters)`

Returns legal opinion cards filtered by matter, claim track, stage, trigger type, and trial relevance.

## 7.4 `listOpinionCardsReferencingEvidence(matter_id, evidence_id)`

Returns legal opinion cards that reference the selected evidence through either:

* `supporting_evidence_ids`
* `opposing_evidence_ids`

This is required for the evidence inspector’s “linked legal opinion cards” section.

## 7.5 `getTrialCardBundle(card_id)`

Returns, in one round trip:

* the legal opinion card;
* resolved supporting evidence summaries;
* resolved opposing evidence summaries;
* evidence title;
* evidence number or label;
* submitted side;
* evidence purpose;
* facts to prove;
* key page;
* key page note;
* trial-use summary;
* cross-examination summary;
* preparation-status badges;
* missing-evidence indicators for dangling IDs.

Performance requirement:

After selecting a legal opinion card in trial mode, the right pane must be renderable from a single IPC call.

Avoid an N+1 pattern where each evidence ID triggers a separate follow-up query.

Matter-level card resolution:

If a LegalOpinionCard has `claim_track_id = null`, evidence preparation resolution should follow this rule:

1. If the linked evidence has exactly one preparation record, use that preparation record.
2. If the linked evidence has multiple preparation records, return all relevant preparation records with claim-track labels and let the right pane display track badges.
3. If the linked evidence exists but has no preparation record, return the existing evidence title/number and show preparation fields as empty.

Distinguish two degraded states:

1. Existing evidence with no preparation record:

   * show the evidence title/number;
   * show empty preparation fields;
   * do not show it as missing evidence.
2. Deleted or unavailable evidence ID:

   * show a visible missing-evidence placeholder.

---

# 8. Deletion and referential integrity

The feature must not crash if existing evidence changes.

Evidence deleted:

If a legal opinion card references an evidence ID that no longer exists, render a visible “missing evidence” placeholder.

Do not silently drop the reference.

Do not throw an exception.

Do not crash the trial mode.

Evidence exists but no preparation record exists:

Render the existing evidence title or number, with empty preparation fields. This is not the same as missing evidence.

Claim track deleted:

Use block-if-referenced behavior.

If a claim track has linked evidence preparation records, cross-examination opinions, or legal opinion cards, block deletion and require the lawyer to clear or move those records first.

Do not cascade-delete prepared legal work product silently.

Dangling ID behavior must be tested.

---

# 9. Plaintiff / defendant behavior

The system should support both client-side roles without separate hardcoded workflows.

When our client is plaintiff:

* main claim track usually has `our_role = asserting`;
* if the opposing party files a counterclaim, the counterclaim track has `our_role = responding`.

When our client is defendant:

* main claim track usually has `our_role = responding`;
* if our side files a counterclaim, the counterclaim track has `our_role = asserting`.

The UI labels may be adapted later, but the underlying model must already support both patterns.

---

# 10. Evidence submitted by each side

Evidence should be classified by side without replacing the existing evidence system.

The preparation layer should support:

* evidence submitted by our side;
* evidence submitted by the opposing side;
* evidence submitted by a third party;
* court-obtained evidence;
* unknown source.

For our evidence, lawyers need to enter:

* evidence purpose;
* facts to prove;
* trial-use summary;
* anticipated objection;
* our response.

For opposing evidence, lawyers need to enter:

* cross-examination opinion on authenticity;
* cross-examination opinion on legality;
* cross-examination opinion on relevance;
* cross-examination opinion on probative force / evidentiary purpose;
* overall opinion;
* courtroom short version.

Related supporting or rebuttal evidence should be linked through a LegalOpinionCard, not directly on CrossExaminationOpinion.

For court-obtained evidence, both sides may need cross-examination treatment, so do not assume only our_side/opposing_side.

---

# 11. Localization

Do not hardcode user-visible UI strings in a way that bypasses the existing localization system.

The product interface ultimately needs to be Chinese.

Machine enum values should remain stable internal values, for example:

* `claim_basis`
* `ready_for_trial`
* `asserting`

Display labels must go through the existing localization mechanism.

Localization acceptance requirement:

No user-visible string literal should appear directly in new renderer components if the existing project has an i18n mechanism. All display text should resolve through i18n keys. Enum values must never render raw to the user.

---

# 12. Persistence and validation

Follow the existing product’s persistence, IPC, and contract/schema validation patterns.

If the project uses JSON schemas, add schemas additively.

If the project uses IPC contracts, add contracts additively.

If migrations are needed, they must be backwards-compatible.

Existing matters without preparation records must still open normally.

Backwards-compatible means:

New code must open matters created before this feature.

This work item does not require old versions of the product to open new data unless the existing release process requires downgrade compatibility.

Do not loosen validation globally.

Do not bypass existing validators.

---

# 13. Non-goals for this next feature

Do not implement:

* AI generation;
* semantic search;
* new OCR engine;
* replacement PDF viewer;
* full PDF annotation system;
* graph visualization;
* cloud sync;
* export to Word;
* export to PDF;
* full final-statement generator;
* complex evidence anchor system;
* advanced relationship graph;
* stub Fact model;
* stub DisputedIssue model;
* unrelated UI redesign;
* replacement of the existing evidence index.

This feature is an additive legal-preparation and trial-navigation layer.

---

# 14. Testing expectations

Add tests using the existing project test conventions.

Before changing schemas or persistence, add characterization coverage for the existing flow if not already covered.

Existing-flow characterization:

* open matter;
* open evidence;
* view evidence document or evidence detail through the current workflow;
* confirm existing matter/evidence loading still works when no preparation data exists.

Minimum required new test coverage:

1. Claim tracks support `our_role = asserting`.
2. Claim tracks support `our_role = responding`.
3. A matter can have both a main claim and a counterclaim.
4. The schema does not enforce a maximum of one counterclaim.
5. Evidence preparation records link to existing evidence IDs.
6. `EvidencePreparation` is unique on `(claim_track_id, evidence_id)`.
7. `facts_to_prove` is an array of short strings.
8. Cross-examination status enums reject invalid values.
9. Cross-examination direction supports `our_objection_to_their_evidence`.
10. Cross-examination direction supports `their_anticipated_objection_to_our_evidence`.
11. `our_response_short_version` is required when direction is `their_anticipated_objection_to_our_evidence`.
12. `CrossExaminationOpinion` is unique on `(claim_track_id, evidence_id, direction)`.
13. Legal opinion cards support all required stages.
14. Legal opinion cards support all required trigger types.
15. `trigger_text` may be null.
16. Legal opinion cards preserve supporting/opposing evidence array order.
17. Trial mode default filtering excludes `draft` and `review_needed`.
18. Trial mode default filtering includes `ready_for_trial`, cards with `used_in_trial_at`, and cards with `follow_up_flagged_at`.
19. `stage = any` cards appear in the General group and match every specific stage filter.
20. Matter-level cards with `claim_track_id = null` remain visible under specific claim-track filters.
21. Selecting a legal opinion card resolves supporting evidence IDs and opposing evidence IDs.
22. `getTrialCardBundle(card_id)` returns resolved evidence summaries in one query.
23. Matter-level legal opinion cards resolve evidence preparation according to the multi-track rules.
24. Existing evidence with no preparation record renders as existing evidence with empty preparation fields.
25. A legal opinion card referencing a deleted evidence ID renders a missing-evidence indicator.
26. Claim-track deletion is blocked when preparation records, cross-examination opinions, or legal opinion cards reference it.
27. Evidence inspector exposes evidence purpose, facts to prove, and cross-examination fields.
28. Evidence inspector shows both cross-examination directions when both records exist.
29. Trial mode permits setting and clearing `used_in_trial_at`.
30. Trial mode permits setting and clearing `follow_up_flagged_at`.
31. Existing matter/evidence loading still works when no preparation data exists.
32. New UI strings go through the existing localization mechanism.
33. Raw enum values are not rendered as user-visible labels.

---

# 15. Acceptance criteria

The feature is acceptable when:

1. The current matter/evidence/document workflow still works through characterization tests.
2. Existing evidence remains the source of truth.
3. New preparation records reference existing matter/evidence/document records.
4. A matter can have a main claim and optional counterclaim.
5. The schema remains future-compatible with multiple counterclaims.
6. Each claim track knows whether our side is asserting or responding.
7. Evidence can be linked to a claim track without replacing the existing evidence record.
8. Lawyers can enter or view evidence purpose and facts to prove.
9. `facts_to_prove` is structured as an array of short strings.
10. Lawyers can enter or view cross-examination opinions for authenticity, legality, relevance, and probative force.
11. Cross-examination supports both our objections to opposing evidence and our anticipated response to objections against our own evidence.
12. When both cross-examination directions exist, the inspector displays both with clear labels.
13. Rebuttal evidence relationships are expressed through LegalOpinionCard links, not through a separate rebuttal field on CrossExaminationOpinion.
14. Lawyers can create or view legal opinion cards by hearing stage and trigger type.
15. `stage = any` cards appear in General and match all stage filters.
16. Matter-level cards remain visible under specific claim-track filters.
17. Trial mode shows legal opinions / speaking material on the left.
18. Trial mode shows evidence navigation and evidence details on the right.
19. Selecting a legal opinion card displays linked supporting and opposing evidence.
20. Trial mode can render the selected card’s evidence bundle from a single IPC/query call.
21. Deleted evidence references render as missing-evidence placeholders rather than crashing or silently disappearing.
22. Existing evidence without preparation records renders as existing evidence with empty preparation fields, not as missing evidence.
23. Claim-track deletion is blocked when legal work product still references the track.
24. The implementation does not introduce AI, semantic search, new OCR, graph visualization, cloud sync, export, full annotation, fact/issue stubs, or unrelated redesign.
25. The implementation remains compatible with Chinese localization.
26. No raw enum value is shown directly to the user.
27. Any conflict between this specification and existing repo conventions is surfaced before implementation rather than resolved silently.

---

# 16. Recommended implementation order

Implement in this order:

First:

Produce the architecture assessment and schema/contract diff, then stop for approval before feature implementation.

Second:

Add characterization coverage for the existing matter/evidence opening flow if not already covered.

Third:

Add additive data models and validation:

* ClaimTrack
* EvidencePreparation
* CrossExaminationOpinion
* LegalOpinionCard

Fourth:

Wire persistence and IPC/contract access using existing patterns.

Fifth:

Add the pre-trial preparation view with:

* claim-track selector;
* evidence preparation inspector;
* cross-examination fields;
* legal opinion card viewer/editor.

Sixth:

Add trial mode with:

* left legal opinion panel;
* right evidence navigation panel;
* supporting/opposing evidence distinction;
* evidence detail panel;
* `getTrialCardBundle`-style resolved query;
* permitted write actions for `used_in_trial_at` and `follow_up_flagged_at`.

Seventh:

Add tests and verification.

---

# 17. Design principle to preserve

The product should evolve from an evidence browser into a litigation preparation system, but incrementally.

Do not replace the existing evidence workflow.

The next feature should prove this loop works end to end:

```text
Claim / response
→ evidence purpose
→ cross-examination
→ legal opinion card
→ trial-mode retrieval
```

The implementation is successful only if the lawyer can prepare a legal opinion before trial, link it to supporting and opposing evidence, then open trial mode and retrieve the opinion and evidence together quickly.
PASTE THE FULL FROZEN FEATURE PLAN HERE
