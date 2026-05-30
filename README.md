# Mandarin Sentence Flashcards

A static Mandarin sentence study app that can be hosted on GitHub Pages.

## GitHub Pages

The app is served from `index.html` and loads its data from `data/`.

To rebuild the static data after changing files in `Sentences/`:

```bash
python3 app.py --export-static
```

Commit the updated `data/` files with the spreadsheet changes.

## Local Preview

For a static preview, serve the repository folder with any local web server:

```bash
python3 -m http.server 8765
```

Then open:

```text
http://127.0.0.1:8765
```

The Python app can also run a local preview:

```bash
python3 app.py
```

## Study Features

- modes for browsing, Chinese-only, English-only, audio-only, and shadowing
- hard cards and review due filtering
- Again / Good / Easy review buttons
- per-card notes
- audio speed, repeat count, and alternating voice loop controls
- last level and last card position saved in the browser

## Offline Audio

Audio files are served from `audio_library/` when present. To download audio from spreadsheet links:

```bash
python3 app.py --download-audio
```

To download one level:

```bash
python3 app.py --download-audio --level level-29-sentences
```

## Keyboard Flow

- Left / Right: previous or next card
- Space: play preferred audio
- 1 / 2: play audio voice 1 or 2
- Enter: reveal answer
- S: mark or unmark hard
- A / G / E: Again, Good, Easy
