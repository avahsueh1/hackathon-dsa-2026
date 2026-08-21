# StreetShift SD MVP

## Product question

Where did Downtown San Diego's observed unsheltered street conditions change
between the organizer-labeled count dates January 31, 2023 and January 25, 2024,
and what can those changes tell us about the overlapping 2023 policy rollout?

## Inputs

- Organizer fixed-panel block observations (`BlockLevel_Counts_Panel261.csv`)
- Organizer block geometry (`Downtown_BlockGrid.geojson`)
- Official Safe Sleeping site addresses, dates, and capacities
- City Police NIBRS records whose `code_section` begins `63.0404`
- Official policy timeline and 2026 City Auditor findings

## Working model

For each of the same 261 blocks, calculate after minus before for:

- direct individual marks;
- tent/structure marks;
- vehicle habitation marks; and
- the Clean & Safe people-equivalent reconstruction:
  `individuals + 1.75 × structures + 2.03 × vehicles`.

Join the results to block polygons. Color decreases green, increases orange, and
unchanged blocks neutral. Preserve every component so the headline weighted
change can be decomposed.

## Product interactions

- Switch the mapped component.
- Hover/click a block to inspect raw before, after, and change values.
- Toggle and inspect both Safe Sleeping sites.
- Toggle six privacy-reduced clusters representing the seven ordinance offense
  records recorded within 500 m of the study area during the policy window.
- Read the five-event timeline and the City Auditor counter-evidence.

## Claims the MVP can support

- Where observations increased or decreased within the fixed Downtown panel.
- Which components and neighborhoods drove the weighted result.
- Where the Safe Sleeping sites are relative to the fixed panel.
- Where nearby police case records documented ordinance offenses.

## Claims it cannot support

- That one policy caused the observed change.
- That a specific person moved from one block into a Safe Sleeping site.
- That an NIBRS offense was a raid, citation, arrest, cleanup, or abatement.
- That a Get It Done report proves enforcement happened.
- That the weighted count is a census of unique people.

## Out of scope

- Forecasting
- Generic CSV integrity review
- EyePop/image ingestion
- Person-level tracking
- Enforcement recommendations
