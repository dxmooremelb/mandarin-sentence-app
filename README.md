# Mandarin Sentence Flashcards

A static Mandarin sentence study app that can be hosted on GitHub Pages.

## GitHub Pages

The app is served from `index.html` and loads its data from `data/`.

Put new level spreadsheets in `Sentences/`. File names can be `.csv` or `.xlsx`, for example:

```text
Sentences/Level 32 Sentences.csv
Sentences/Level 32 Sentences.xlsx
```

Then run the sync helper:

```bash
python3 sync_levels.py
```

That command downloads missing audio into `audio_library/`, then rebuilds the static JSON in `data/`.

To sync just one new level's audio and still rebuild the JSON index:

```bash
python3 sync_levels.py --level "Level 32"
```

To rebuild JSON without downloading audio:

```bash
python3 sync_levels.py --skip-audio
```

The equivalent app command is:

```bash
python3 app.py --sync-static
```

Commit the updated `data/` files and any new `audio_library/` files with the spreadsheet changes.

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

Audio files are served from `audio_library/` when present. The sync helper stores files by level and voice, for example:

```text
audio_library/level-32-sentences/audio-1/
audio_library/level-32-sentences/audio-2/
```

To only download audio without rebuilding JSON:

```bash
python3 app.py --download-audio
```

## Keyboard Flow

- Left / Right: previous or next card
- Space: play preferred audio
- 1 / 2: play audio voice 1 or 2
- Enter: reveal answer
- S: mark or unmark hard
- A / G / E: Again, Good, Easy
