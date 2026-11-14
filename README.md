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
2. **Analyse tab:** choose the video, pick your coach and whether it was filmed outdoors or indoors, optionally pick an **earlier attempt at the same climb to compare with** (shown with thumbnails), add the name, grade and result, then tap **Analyse climb**. Pointing out the climber and trimming are optional, under "Optional": without a tap the app follows the person highest on the wall.
3. **Report:** it reads top to bottom, most useful first:
   - **Summary:** the climb, your technique score, the coach's short take, and **how it ended** (topped out, held the top, lowered off or fell, detected from the video with a confidence level). Tap to correct it.
   - **Fix these first:** every fall, then the top habits to change (one with the quick-look coach, three otherwise). Each one gets a card with:
     - a **big animated skeleton replay** of the moment it happened, made from the stored poses so no video is needed. The body part at fault is in red. The holds you were using are shown as grey shapes, estimated from where your hands and feet stayed still. A **green guide** shows what to do instead where the app can work it out: the straight-arm line and where your shoulder would be, where to put your hips over your feet, or the foothold you stepped to later ("foot here first").
     - a **freeze-frame on the mistake** with a plain note ("Your left arm is bent to about 75° while it holds you…"), step buttons (Get set / Reach / Grab / ⚠ Mistake), frame-by-frame stepping, ¼×, ½× and 1× speed, and **Watch this in your video** when the video is attached;
     - **the moves where it happened**, worst first: tap one to replay it.
     - Under the replay: what went wrong, why it matters, **do this instead**, a drill to practise it, and a goal for next time. Fall cards add the fixes for that cause, a plan for your next attempt and anything else that played a part.
   - **What you did well:** a short list.
   - **Vs your earlier attempt** (if you picked one): what got better, what got worse and what to do on the next go.
   - **Everything else**, folded away: technique scores, the height-over-time chart and key moments, move by move, start/middle/top, left vs right, other observations, the per-area breakdown, how you moved (PLOS ONE movement states), techniques spotted, the half-second movement timeline with label export, comparison with earlier climbs, how sure the analysis is, and every measurement.
   - **Three coaches, one per analysis level.** *Magnus* (quick look: fastest model, one habit to fix), *Alex* (all-round: standard model and mirrored check) and *Eric* (deep dive: largest model, "Everything else" open by default). Their names are playful first-name nods to well-known climbing coaches/YouTubers, not the real people. Pick a coach in Guide → Your coach or before each climb.
   - **Outdoor / indoor.** Set where you climb (Guide → Settings, or per climb). Outdoor searches the frame down to small tiles and retries more missed frames for far-away climbers. Indoor expects a closer climber, so it searches faster, and fall tips cover gym holds instead of rock conditions.
   - **Coaching that follows up instead of repeating itself.** A problem that keeps coming back shows how its score has moved and gets a different cue and drill each time. Strengths you've kept for several climbs are summed up in one line. Falling the same way again is flagged as a pattern.
   - **Light / dark mode.** Guide → Settings → Appearance: Auto (follows the phone), Light or Dark.
4. **History / Progress:** every climb is saved on the device. Progress shows score trends, send rate, hardest send, and your recurring weak spots.
5. **Guide:** set your height (for metre estimates), switch analysis quality, and export or import backups.

## Outdoor and far-away videos

- **Zoomed tracking:** the pose model only looks at about 256 px, so a far-away climber would be a few pixels tall. The app follows the climber with a crop taken from the full-resolution video, so the model sees them large. If it loses them, it scans the whole frame in tiles to find them again.
- **Picking the right person:** the tap tells it who the climber is. Without a tap it picks the highest person in the frame, which is usually the climber rather than the belayer.
- **Camera movement:** pans are measured by matching the rock texture around the climber against a reference frame, then removed from the measurements.
- **Changing size on screen:** you get smaller on screen as you climb away from the camera (or if the zoom changes). Your apparent size is tracked through the climb, ignoring brief leans and turns, and every measurement is rescaled to a constant body size.
- **Left/right mix-ups:** pose models often swap left and right on small figures or climbers seen from behind. These swaps are detected and undone over time.
- **Hidden legs:** legs are often partly hidden behind the body. Each frame is analysed twice (normal and mirrored) and the results are combined. Doubtful points are weighted down by a smoothing filter instead of being thrown away, hidden stretches are bridged using body proportions, and hold detection only trusts limbs while they're actually visible. In the replay, estimated parts of the skeleton are drawn faded and dashed.
- **Small-figure safeguards:** more smoothing, jitter-aware hold detection, and fine-detail scores (grip and foot readjustments) are skipped when the climber's torso is under about 60 px.

## Movement labelling framework

The labels follow an observational framework for climbing video: short multi-label windows instead of one label per move; left/right, contact state and visibility kept for everything; transitions (reach, touch/probe, grip-set, weight-transfer, foot-set, foot-swap, cross-through, hand-match, release, catch, regrip, rest/shake) as separate events; and "unknown" instead of guessing anything a single camera can't show. The mechanics and terminology come from REI's climbing technique guide, *Role of route previewing strategies on climbing fluency and exploratory movements* (PLOS ONE, 2017), *Biomechanical Principles and Techniques: A Systematization for Sport Climbing* (MDPI Sports), and crack-climbing guides from the American Alpine Institute and The Mountaineers. **The detection thresholds are this app's own rules, not values validated by those studies**, and nothing here is a trained machine-learning model: it's rules applied to the pose data. The rules are tested against simulated climbs in `tests/`.

## What it measures

| Area | Measures |
|---|---|
| Footwork | Foot moves per hand move; foot readjustments after placing ("quiet feet") |
| Arm efficiency | Share of static time on straight arms; how much of your upward movement comes from legs vs. arms |
| Body position | Centre of mass over your feet when static; hip turning (reported, not scored) |
| Flow | Path efficiency, sudden jolts, hesitations, grip readjustments |

It also detects rests, dynamic moves and falls. Thresholds and scoring rules live in `js/metrics.js` (`CFG`) and `js/coach.js` (`METRIC_DEFS`).

## Checked on real videos

Besides the synthetic tests, the analysis has been checked frame by frame against real indoor board videos (handheld phone that pans, tilts and zooms; climbers walking to and from the phone; a second person in shot; a climber half out of frame at the start). On those, the pose tracking itself held up well, and the fixes went into what comes after it: cutting the walk to and from the phone, finding when the climb really starts, not counting drops before the climb as falls, and telling a settled let-go from the top apart from a fall. Each case has a synthetic regression test. The reference videos and their pose tracks are not stored in this repository.

## Limitations

- It works from a 2D picture, so it can't see the distance from your hips to the wall, the wall angle, or the holds.
- The pose model isn't climbing-specific. Occlusion, bad light or being far from the camera reduce accuracy, and the report warns you when tracking was poor.
- Camera pans and gradual size changes (climbing away from the camera, slow zooms) are compensated for. Sudden zoom jumps mid-move and plain-sky backgrounds are still hard.
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
js/outcome.js                finish/top-out/fall detection and fall cause analysis (pure, tested)
js/falladvice.js             coaching for each fall cause
js/mistakes.js               falls + habits to fix, with the moves that show each one best (pure, tested)
js/replay.js                 big animated skeleton replay with holds, red/green guides and freeze-frame notes
js/labels.js                 multi-label movement timeline, PLOS ONE movement states, events, repertoire (pure, tested)
js/timeline.js               movement timeline view + label export
js/refine.js                 pose clean-up: left/right fixes, confidence-weighted smoothing, bone lengths (pure, tested)
vendor/mediapipe/            MediaPipe Tasks Vision 1.0.1 JS + WASM (Apache 2.0)
models/                      pose_landmarker lite / full / heavy models (Apache 2.0)
sw.js, manifest.webmanifest  offline support + installable app
tests/                       node:test suite with a synthetic climber; outdoor-scene.html test fixture;
                             report-preview.html renders a full report from a simulated climb (npm start, then open it)
```
