# 呼吸 — A Breathing Space With No Instructions

A breathing web app with no guidance, no timer, no voice prompts. Just a circle breathing on its own. You walk in, you breathe together.

**Try it:** https://asstarivm.github.io/breath-ensoulra/

## What it is

- A circle that breathes slowly on its own
- No signup, no tracking, no analytics, no ads
- Optional heart rate monitor (rPPG webcam, all local)
- Optional breath rate monitor (Web Audio API microphone, all local)
- When you leave, it asks "帶走嗎？" — download a chart of your session
- A light fades out. No "Great job!" No streak counter.

## Why

Every breathing app I found wanted to tell me what to do. I wanted a space where I could just breathe — not because something told me to, but because I walked in and my body remembered how.

[Read the full story →](https://asstarivm.github.io/breath-ensoulra/story.html)

## Tech

- Vanilla HTML/CSS/JS — no frameworks, no build tools
- Hosted on GitHub Pages — free, permanent
- `hrv-module.js` — rPPG webcam heart rate (Butterworth bandpass + adaptive threshold)
- `audio-hrv-proxy.js` — Web Audio API breath rate (FFT + peak detection)
- `idle-pulse-module.js` — ambient idle pulse
- Event-driven metrics (6 event types, localStorage, no upload)

## Files

- `index.html` — the breathing space (base version)
- `breath-v3.1.html` — v0.3 with T2 threshold + closing ritual + Reincorporation
- `story.html` — why I built this
- `sitemap.xml` — for search engines

## License

MIT — do whatever you want. Just let people breathe.
