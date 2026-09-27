# Crux Coach: climbing technique analyser

A free web app for iPhone (and any modern browser). Upload a climbing video and it analyses your technique on the phone itself: footwork, straight arms, leg drive, balance, flow and hesitations. You get scores, specific feedback, drills, and a progress overview across all your sessions.

- **Free:** a static site with no server, no API keys and no subscriptions.
- **Private:** videos never leave your phone.
- **No installs:** no local LLM, no computer. The pose model (Google MediaPipe Pose, about 9 MB) loads in Safari like any other web page file and is cached after the first run.

## Put it on your iPhone (free hosting with GitHub Pages)

1. On GitHub, go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, pick the branch with the app (e.g. `main`, or `claude/trusting-keller-3ojvfg`) and folder **`/ (root)`**, then click **Save**.
2. After a minute or two the app is live at `https://sofcowebsite.github.io/climbing-analyser/`.
3. Open that link in **Safari** on your iPhone, tap **Share → Add to Home Screen**. It now opens full-screen like an app and works offline.

Any free static host also works: Netlify, Cloudflare Pages, or Vercel. Just point it at the repo root. There is no build step.

## Using it

1. **Film:** filming from far away (e.g. outdoors from the base of the crag) is fine. Record in 4K, use the 2×/3× lens if the route still fits, keep the camera as still as you can, and don't zoom while recording.
2. **Analyse tab:** choose the video, **tap on the climber** (important when the belayer or other people are in shot), optionally trim it to the climb, add the name, grade and result, then tap **Analyse climb**. Expect roughly 30–90 s per minute of video on a recent iPhone.
3. **Report:** a detailed breakdown:
   - **Your plan for next session:** the top 3 changes, each with what we saw (and on which moves), why it matters, what to do next time, a drill and a target number.
   - **Move by move:** every hand move with ✓/✗ checks (feet first? straight arm? legs or arms? hips over feet? controlled arrival? hesitation? re-grip?). Tap to watch it.
   - **Start / middle / top:** how your technique changed as you got higher and more tired.
   - **Left vs right:** imbalances between your arms and legs.
   - **Detailed breakdown per area**, extra observations (feet cutting loose, high steps, shake-outs, stance, pace), and a **comparison with your previous climbs**.
   - Height-over-time chart, key moments, and a video replay with a skeleton overlay.
4. **History / Progress:** every climb is saved on the device. Progress shows score trends, send rate, hardest send, and your recurring weak spots.
5. **Guide:** set your height (for metre estimates), switch analysis quality, and export or import backups.

## Outdoor and far-away videos

- **Zoomed tracking:** the pose model only looks at about 256 px, so a far-away climber would be a few pixels tall. The app follows the climber with a crop taken from the full-resolution video, so the model sees them large. If it loses them, it scans the whole frame in tiles to find them again.
- **Picking the right person:** the tap tells it who the climber is. Without a tap it picks the highest person in the frame, which is usually the climber rather than the belayer.
- **Camera movement:** pans are measured by matching the rock texture around the climber against a reference frame, then removed from the measurements. Zooming during the video is not compensated.
- **Left/right mix-ups:** pose models often swap left and right on small figures or climbers seen from behind. These swaps are detected and undone over time.
- **Hidden legs:** legs are often partly hidden behind the body. Each frame is analysed twice (normal and mirrored) and the results are combined. Doubtful points are weighted down by a smoothing filter instead of being thrown away, hidden stretches are bridged using body proportions, and hold detection only trusts limbs while they're actually visible. In the replay, estimated parts of the skeleton are drawn faded and dashed.
- **Small-figure safeguards:** more smoothing, jitter-aware hold detection, and fine-detail scores (grip and foot readjustments) are skipped when the climber's torso is under about 60 px.

## What it measures

| Area | Measures |
|---|---|
| Footwork | Foot moves per hand move; foot readjustments after placing ("quiet feet") |
| Arm efficiency | Share of static time on straight arms; how much of your upward movement comes from legs vs. arms |
| Body position | Centre of mass over your feet when static; hip turning (reported, not scored) |
| Flow | Path efficiency, sudden jolts, hesitations, grip readjustments |

It also detects rests, dynamic moves and falls. Thresholds and scoring rules live in `js/metrics.js` (`CFG`) and `js/coach.js` (`METRIC_DEFS`).

## Limitations

- It works from a 2D picture, so it can't see the distance from your hips to the wall, the wall angle, or the holds.
- The pose model isn't climbing-specific. Occlusion, bad light or being far from the camera reduce accuracy, and the report warns you when tracking was poor.
- Camera pans are compensated for, but zooming during a video isn't. Against plain sky there's no texture to track.
- iOS may clear website data for sites you haven't used in a while. Add the app to your Home Screen and use **Export backup** occasionally.

## Development

```sh
npm start        # serves on http://localhost:8080
npm test         # unit tests for the metrics and coaching logic (Node 18+)
```

The project layout:

```
index.html, css/, js/        app (plain ES modules, no build step)
js/metrics.js                pose frames → metrics (pure, tested)
js/coach.js                  metrics → scores + feedback (pure, tested)
js/pose.js                   MediaPipe Pose in the browser + zoomed climber tracking
js/camera.js                 camera-movement estimation (pure, tested)
js/refine.js                 pose clean-up: left/right fixes, confidence-weighted smoothing, bone lengths (pure, tested)
vendor/mediapipe/            MediaPipe Tasks Vision 1.0.1 JS + WASM (Apache 2.0)
models/                      pose_landmarker lite / full / heavy models (Apache 2.0)
sw.js, manifest.webmanifest  offline support + installable app
tests/                       node:test suite with a synthetic climber; outdoor-scene.html test fixture
```
