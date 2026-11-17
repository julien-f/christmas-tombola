# Plan: draw fixes (branch `draw-fixes`)

From the draw review. Deleted before the merge.

## Commits

1. **fix(draw): prune the search with the matching check**
   - `searchAssignment`: after placing a candidate (so reciprocity with it counts), recurse only if `hasMatching([...remaining], [...free], canDraw)`.
   - Uniformity comment (`utils.mjs:80-81`): only when sampling succeeds.
   - Test first (seen failing): separate `it`, 3 groups of 10, seeds 0-9.
   - The step-limit throw stays: with the prune only reciprocity among open sources can backtrack.
2. **perf(draw): check the matching before sampling**
   - `fill = () => hasMatching(...) && (sample || search)`; the root check leaves `searchAssignment`.
   - Test (in "fails fast on impossible games"): 10 kept pairs + new group of 11 throws "no valid draw exists" with < 1000 `random` calls (no clock).
3. **fix(draw): notify only players whose target changed**
   - `notify = ids.filter((id) => lottery[id] !== previous[id])`; drop the `notify` Set.
   - Test first: previous = draw of A-F, players `[["A","N"],"B",…,"F"]`, seeds 0-199, `notify` = ids whose target changed.
   - `utils.test.mjs:237` → `notify.includes(giverToX)`.
4. **feat(draw): release a single pair when it suffices**
   - Before the incremental release, try releasing each kept pair alone (shuffled order), restoring it on failure.
   - Test first: same scenario, exactly 2 notified.
5. **test(draw): brute-force test with a random previous lottery**
   - Extend "agrees with brute force": random partial `previous` (ids + a departed "X", random targets incl. self, reciprocal, duplicate).
   - Assert: valid; dropped + kept = `previous`; dropped pairs each invalid alone, reusing a kept target, or reverse of a kept pair; new players notified; throws `/no valid draw exists/` iff impossible.

## Out of scope

- Uniform fallback; minimal release when 2+ pairs are needed.
- Non-string ids in a hand-edited `lottery.json`; atomic write of `lottery.json`.
