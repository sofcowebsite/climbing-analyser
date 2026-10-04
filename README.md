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
3. **Report:** a detailed breakdown:
   - **Your plan for next session:** the top 3 changes, each with what we saw (and on which moves), why it matters, what to do next time, a drill and a target number.
   - **How it ended:** topped out, matched and held the top hold, lowered off, or fell. It's detected from the video, with the evidence and a confidence level shown, and you can correct it with one tap. Reaching a hold and coming off within about a second counts as a fall, not a finish.
   - **Every fall broken down:** an animated skeleton replay of the last 3 seconds, zoomed in with the part that let go highlighted (works without the video). Then the most likely cause (missed catch, late dead-point, over-reach, feet cutting, hand slip, foot slip, barn door, lock-off, stalling, pump), how sure the app is, why it makes you fall, specific fixes, a drill, and a plan for your next attempt.
   - **How you moved:** time spent still, adjusting your body, exploring holds, changing holds and pulling/pushing up (the movement states from the PLOS ONE 2017 route-previewing study), plus stops, probes (touching a hold and letting go) and the IFSC-style check that your body rises as the hand goes to the next hold. It's reported as behaviour, not as a skill rating.
   - **Technique repertoire:** high steps, flags (inside/outside), drop knees, frog, hand/foot matches, foot swaps, cross-throughs, catches, mantles, traverses, stems and laybacks, each with a confidence level, plus suggestions for the terrain you picked (slab, vertical, overhang, roof, arête, corner, crack).
   - **Movement timeline:** every half second gets multiple labels (role, static/dynamic, visible contacts, each hand and foot, orientation, hip movement, arm and leg posture, balance, flag, movement family, hold direction, events, outcome, visibility). Anything a single camera can't show (grip type, hips-to-wall distance, whether a foot is weighted, crack jam type) is labelled *unknown* rather than guessed. Tap a moment to see its labels, and **export them as JSON**. Reviewed exports are the raw material for training a real model later.
   - **Move by move:** every hand move with ✓/✗ checks (feet first? straight arm? legs or arms? hips over feet? controlled arrival? hesitation? re-grip?). Tap to watch it.
   - **Start / middle / top:** how your technique changed as you got higher and more tired.
   - **Left vs right:** imbalances between your arms and legs.
   - **How sure are we?** Every finding carries a confidence level based on tracking quality, how visible the relevant limb was and how much evidence there is. Uncertain findings are worded as "possibly" and kept out of the plan. Issues seen on most moves are reported once as a pattern instead of on every move.
   - **Detailed breakdown per area**, extra observations (feet cutting loose, high steps, shake-outs, stance, pace), and a **comparison with your previous climbs**.
   - **Three coaches, one per analysis level.** *Magnus* (quick look: fastest model, short plain report with one thing to work on), *Alex* (all-round: standard model and mirrored check, main report with the technical extras under "More detail") and *Eric* (deep dive: largest model, everything shown) — playful first-name nods to well-known climbing coaches/YouTubers, not the real people. Each report opens with the coach's short take in plain language. Pick a coach in Guide → Your coach or before each climb.
   - **Outdoor / indoor.** Set where you climb (Guide → Settings, or per climb). Outdoor searches the frame down to small tiles and retries more missed frames for far-away climbers; indoor expects a closer climber, so it searches faster, and fall tips cover gym holds instead of rock conditions.
   - **Compare two attempts.** Pick an earlier attempt before analysing and the report gets a "Vs your earlier attempt" chapter: both thumbnails side by side, result, high point, the move you came off on, technique score, what got better, what got worse, what stayed the same, and a numbered list of what to do on the next attempt. The coach's take mentions it too.
   - **Light / dark mode.** Guide → Settings → Appearance: Auto (follows the phone), Light or Dark.
   - **Coaching that follows up instead of repeating itself.** Each climb is coached with your earlier climbs in mind: a problem that keeps coming back shows how its score has moved and gets a different cue and drill each time, explanations you've already read twice are left out, strengths you've kept for several climbs are summed up in one line, fixes since your last climb are called out, and falling the same way again is flagged as a pattern with a different lead fix and drill.
   - Height-over-time chart, key moments, and a video replay with a skeleton overlay.
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
js/fallview.js               animated skeleton replay of a fall
js/labels.js                 multi-label movement timeline, PLOS ONE movement states, events, repertoire (pure, tested)
js/timeline.js               movement timeline view + label export
js/refine.js                 pose clean-up: left/right fixes, confidence-weighted smoothing, bone lengths (pure, tested)
vendor/mediapipe/            MediaPipe Tasks Vision 1.0.1 JS + WASM (Apache 2.0)
models/                      pose_landmarker lite / full / heavy models (Apache 2.0)
sw.js, manifest.webmanifest  offline support + installable app
tests/                       node:test suite with a synthetic climber; outdoor-scene.html test fixture
```
