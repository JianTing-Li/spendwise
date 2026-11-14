# DOCS-04 — Replace README GIF with the full demo video

Owner: Jian Ting. Issue: https://github.com/JianTing-Li/spendwise/issues/64
Branch: `docs-04-demo-gif`.

## Changes
Replaced `docs/demo.gif` with a GIF made from Jian's 60-second screen recording (`SpendWise Demo.mov`, 1412×982, H.264). The new GIF is 960×668, 8 fps, 60.75 s and 6.3 MB. The old one was 1224×683, 21 s and 3.7 MB. The README already points at `docs/demo.gif`, so no README text changed. Added the DOCS-04 row to `docs/handoff.md`.

## Decisions
Frames were extracted with ffmpeg (lanczos scaling) and encoded with gifski. A 1000px, 10 fps, quality-80 pass came to 10.7 MB, which is too heavy for a README. Quality 60 at 960px and 8 fps (4.7 MB) left smeared leftovers from earlier frames. Quality 70 (6.3 MB) is the smallest setting that stayed clean.

## Verification
Checked size, dimensions and duration with ffprobe; inspected a cropped mid-video frame at quality 60 and 70; confirmed the README image path exists. Docs only, so application tests were not run.
