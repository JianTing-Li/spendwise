# DOCS-02 — Deployed investigation screenshot

Owner: Elliot. Issue: [#53](https://github.com/JianTing-Li/spendwise/issues/53).

## Change
- Captured https://spendwise-olive-theta.vercel.app/ on 2026-11-10 through its public, synthetic, read-only dashboard. Existing real-model completed findings were visible; no sign-in, mutation, new investigation or model request was made.
- Saved `docs/screenshot.png` (1152 × 2004). It shows the first row of the investigation queue: Harbor Advisory's possible duplicate, the agent's draft explanation and payment/invoice citations, recommended next steps, and disabled human acknowledgment controls. Fieldwork Studio's adjacent investigation is also visible.
- The browser provided a full-page JPEG. The saved PNG is a crop of that capture, converted to PNG without added, removed or rewritten UI content. SHA-256: `981f686aac2a55d2474983793580d89c40c72f50349a0111372245f2bd206db9`.
- Embedded the image near the README opening with exact alt text `SpendWise investigation view` and a caption explaining public read-only controls. Added the task to the issue index.

## Verification
- Visually inspected the deployed dashboard and saved PNG: flagged vendor payments, cited evidence, `Mark reviewed` and `Inspect source records` are visible. Review is acknowledgment only; it does not approve payment or verify the model explanation.
- Checked PNG signature, all chunk checksums, dimensions, target existence, exact alt text, and placement before `Results so far`; passed.
- Confirmed the README differs only by the image and caption. This documentation-only change does not require application tests.
- Relevant invariants: INV-01, INV-05, INV-06, INV-12.

## Handoff
- PR #52 independently rewrites README.md and changes the UI. This branch starts at main `d6ab7a9f3b0f3b3b99d11e2a9700f4bb05ffed1a` and preserves all existing content. The screenshot records the deployed view at capture time; it may need refreshing after UI changes land.
- Requested next action: review the screenshot and additive README placement alongside PR #52. No merge or deployment is authorized.
