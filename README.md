# Mandarin Blueprint Local App

Run the local sentence reader:

```bash
python3 app.py
```

The app looks for level spreadsheets in:

```text
~/Documents/Mandarin Blueprint/Sentences
```

Add future files there using the same pattern, as `.xlsx` or `.csv`, for example:

```text
Level 30 Sentences.xlsx
Level 31 Sentences.csv
```

Then refresh the app and the level will appear in the level controls.

Traverse export:

Use [tools/traverse_sentence_exporter.js](/Users/danielmoore/Documents/Mandarin%20Blueprint/mandarin-blueprint-local-app/tools/traverse_sentence_exporter.js) from the browser console on a Traverse sentence level page.

After pasting the script, run:

```js
exportCurrentTraverseSentenceLevel({ level: 27 });
```

It downloads `Level 27 Sentences.csv`, which can be placed directly in the `Sentences` folder.

Bulk Traverse export:

Use [tools/traverse_bulk_crawler.js](/Users/danielmoore/Documents/Mandarin%20Blueprint/mandarin-blueprint-local-app/tools/traverse_bulk_crawler.js) from the browser console while logged in to Traverse.

If you have sentence-level URLs, paste the script and run:

```js
await scrapeTraverseSentenceUrls([
  {
    level: 27,
    url: "https://traverse.link/Mandarin_Blueprint/awmqk6ruwxb8u6wmlyq3e86f/?showMap=1"
  }
]);
```

For multiple levels, add more `{ level, url }` entries. The script opens a worker window, scrapes each sentence level, and downloads one CSV per level plus a manifest.

Experimental discovery from a Traverse map page:

```js
await crawlTraverseFromCurrentPage({ maxDepth: 4, scrape: true });
```

This only works for pages Traverse exposes as crawlable links to your logged-in browser. It cannot guess private page IDs that are not linked anywhere.

Study features are saved locally in your browser:

- modes for browsing, Chinese-only, English-only, audio-only, and shadowing
- hard cards and review due filtering
- Again / Good / Easy review buttons
- per-card notes
- audio speed, repeat count, and alternating voice loop controls
- last level and last card position

Offline audio:

```bash
python3 app.py --download-audio
```

This downloads spreadsheet audio links into:

```text
mandarin-blueprint-local-app/audio_library
```

Files are organized by level and voice. Once downloaded, the app automatically uses the local files and the audio buttons show `Local`.

To download one level:

```bash
python3 app.py --download-audio --level level-29-sentences
```

Keyboard flow:

- Left / Right: previous or next card
- Space: play preferred audio
- 1 / 2: play audio voice 1 or 2
- Enter: reveal answer
- S: mark or unmark hard
- A / G / E: Again, Good, Easy

Open:

```text
http://127.0.0.1:8765
```

To use a different folder:

```bash
python3 app.py --folder ~/Documents/Mandarin\ Blueprint/Sentences
```

Stop with `Ctrl + C` in Terminal.
