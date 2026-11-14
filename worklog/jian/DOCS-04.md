# DOCS-04 — Replace README GIF with the full demo video

Owner: Jian Ting. Issue: https://github.com/JianTing-Li/spendwise/issues/64
Branch: `docs-04-demo-gif`. PR: https://github.com/JianTing-Li/spendwise/pull/65

## Changes
Replaced `docs/demo.gif` with a subtitled GIF of Jian's 60-second screen recording (`SpendWise Demo.mov`, 1412×982, H.264). Sixteen subtitles, approved by Jian, explain each step (load payments, flags, the Northstar, Valley Dairy and Fieldwork cases, switching companies) on a dark band added below the app, so no UI is covered. The GIF is 840×662, 8 fps, 60.76 s and 7.7 MB. The old one was 1224×683, 21 s, 3.7 MB, with no subtitles. The README already points at `docs/demo.gif`, so no README text changed. Added the DOCS-04 row to `docs/handoff.md`.

## Decisions
- The first version of this PR used the recording without subtitles (960px, 6.3 MB). Jian then asked for subtitles for a LinkedIn post and wanted the README GIF to match.
- Subtitles were drawn with libass (`ffmpeg-full`) straight onto frames from the original recording. Encoding the subtitled MP4 instead carried compression noise into the GIF and made it larger.
- gifski left faint ghosts of the previous subtitle in the dark band, even with lossy quality at 100. ffmpeg's palette encoder with exact frame diffs and no dithering is clean.
- 840px wide: GitHub's README column is about 830–880px, so a wider GIF is scaled down anyway. A clean GIF at 960px was 9.6 MB.
- The Fieldwork subtitle reads "Let's check with the vendor. If we paid twice, we ask for a refund." This is Jian's wording. On screen, the agent marks the case "Records explain it" (two different invoices).

## Verification
Checked size, dimensions and duration with ffprobe. Decoded the GIF from the start and inspected frames at 15 s and 51 s for subtitle readability and leftover-frame artifacts. Confirmed the README image path exists. Docs only, so application tests were not run.
