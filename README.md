# Crux Coach: climbing technique analyser

A free web app for iPhone (and any modern browser). Upload a climbing video and it analyses your technique on the phone itself: footwork, straight arms, leg drive, balance, flow and hesitations. You get scores, specific feedback, drills, and a progress overview across all your sessions.

- **Free:** a static site with no server, no API keys and no subscriptions.
- **Private:** videos never leave your phone.
- **No installs:** no local LLM, no computer. The pose model (Google MediaPipe Pose, about 9 MB) loads in Safari like any other web page file and is cached after the first run.

## Put it on your iPhone (free hosting with GitHub Pages)

1. Merge this branch into `main`.
2. On GitHub, go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, then branch **`main`** and folder **`/ (root)`**, and click **Save**.
3. After a minute or two the app is live at `https://sofcowebsite.github.io/climbing-analyser/`.
4. Open that link in **Safari** on your iPhone, tap **Share → Add to Home Screen**. It now opens full-screen like an app and works offline.

Any free static host also works: Netlify, Cloudflare Pages, or Vercel. Just point it at the repo root. There is no build step.

## Using it

1. **Film:** phone on a tripod (or propped up), whole body in frame, good light, one climber.
2. **Analyse tab:** choose the video, optionally trim it to the climb, add the name, grade and result, then tap **Analyse climb**. Expect roughly 20–60 s per minute of video on a recent iPhone.
3. **Report:** you get an overall score, four technique areas, what you did well, what to work on (with drills), a height-over-time chart, and key moments you can tap to jump the video there. You can replay the video with a skeleton overlay.
4. **History / Progress:** every climb is saved on the device. Progress shows score trends, send rate, hardest send, and your recurring weak spots.
5. **Guide:** set your height (for metre estimates), switch analysis quality, and export or import backups.

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
- A moving camera distorts the movement measurements.
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
js/pose.js                   MediaPipe Pose in the browser
vendor/mediapipe/            MediaPipe Tasks Vision 1.0.1 JS + WASM (Apache 2.0)
models/                      pose_landmarker_full / lite models (Apache 2.0)
sw.js, manifest.webmanifest  offline support + installable app
tests/                       node:test suite with a synthetic climber
```
