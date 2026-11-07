# RsWork promo video (Blender)

A 3-minute, 1080p/30 fps motion-graphics product video, built entirely by code in
Blender 5.2 (Eevee). There is nothing to animate by hand: `rswork_promo.py` creates every
shape, text, icon, photo and keyframe, so the video is edited by changing the script.

| File | What it is |
|---|---|
| `rswork_promo.py` | The whole video: 11 scenes ("shots") with their timings |
| `rswork_ad60.py` | A 60-second commercial in plain language (reuses the promo's building blocks); render with `render.ps1 -Ad` |
| `make_music.py` | Synthesizes a royalty-free music bed + sound effects synced to the animation |
| `render.ps1` | One command: events → music → frames → `out/RsWork_promo.mp4` |
| `VOICEOVER.md` | Narration script timed to each scene |
| `out/` | Renders (gitignored) |

## Render
```powershell
powershell -ExecutionPolicy Bypass -File video\render.ps1
```
About 45 minutes on an RTX 4060. An interrupted render resumes where it stopped.

## Edit
- **Open it in Blender** to scrub the timeline: `blender -P video\rswork_promo.py`
  (press Numpad 0 for the camera view and switch the viewport to Rendered).
- **Change text or timings** in the matching `sXX_...()` function. Times are in seconds;
  each `with Shot(start, end)` block is one scene.
- **Check a moment quickly** without rendering everything:
  `blender -b -P video\rswork_promo.py -- --preview video\out\preview 45 120`
- Colours live in the `HEX` palette at the top (taken from the app theme + logo).

## Scenes
| Time | Scene |
|---|---|
| 0:00 | Logo + "Scan. Order. Serve. Grow." |
| 0:09 | The problem: slow ordering, lost tickets, no visibility |
| 0:26 | Meet RsWork: diner → kitchen → waiter → cashier → manager |
| 0:38 | Guest phone: QR scan, trilingual menu, suggestions, live tracking, pay, rate |
| 1:04 | Kitchen display: live tickets moving New → Preparing → Ready |
| 1:24 | Waiter phone: ready / bill alerts, sections, claim |
| 1:38 | Cashier: one-tap settlement, receipt, table freed |
| 1:50 | Owner laptop: dashboard, menu, tables & QR, staff, feedback |
| 2:18 | Forecast chart + AI report + typed insight |
| 2:38 | Security, speed, tests, stack |
| 2:50 | Call to action |

The demo data (Le Jasmin, orders, staff names, numbers) is illustrative, like the app's
seeded demo restaurant. The menu photos are the ones in `scripts/assets/menu/`.
