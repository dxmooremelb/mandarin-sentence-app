/*
  Traverse sentence level exporter.

  Usage from a Traverse sentence-level page:
    1. Open the sentence level map, for example:
       https://traverse.link/Mandarin_Blueprint/awmqk6ruwxb8u6wmlyq3e86f/?showMap=1
    2. Open the browser console.
    3. Paste this whole file.
    4. Run:
       exportCurrentTraverseSentenceLevel({ level: 27 });

  The downloaded CSV can be dropped straight into:
    ~/Documents/Mandarin Blueprint/Sentences

  The local app now accepts both .csv and .xlsx level files.

  python3 app.py --download-audio

*/

const TraverseSentenceExporter = (() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function downloadCsv(csv, filename) {
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function csvEscape(value) {
    return `"${String(value || "").replace(/"/g, '""')}"`;
  }

  function toCsv(rows) {
    return [
      ["Chinese", "English", "Audio 1", "Audio 2", "Raw Text"],
      ...rows.map((row) => [
        row.chinese,
        row.english,
        row.audio1,
        row.audio2,
        row.rawText,
      ]),
    ]
      .map((row) => row.map(csvEscape).join(","))
      .join("\n");
  }

  function visible(el) {
    return Boolean(el && el.offsetParent !== null);
  }

  function chineseOnlyText(text) {
    const value = String(text || "").trim();
    return (
      value &&
      /[\u4e00-\u9fff]/.test(value) &&
      !/[a-zA-Z]/.test(value) &&
      value.length <= 80
    );
  }

  function findMapContainer(root = document) {
    const candidates = [...root.querySelectorAll("div")].filter((el) => {
      const className = el.className?.toString() || "";
      const text = el.innerText || "";
      return (
        visible(el) &&
        (className.includes("overflow-y-auto") ||
          el.scrollHeight > el.clientHeight + 80) &&
        /[\u4e00-\u9fff]/.test(text)
      );
    });

    return (
      candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || null
    );
  }

  async function collectSentenceItems() {
    const container = findMapContainer();
    if (!container)
      throw new Error("No scrollable sentence map container found.");

    const byText = new Map();
    let stablePasses = 0;
    let previousCount = 0;

    container.scrollTop = 0;
    await sleep(400);

    while (stablePasses < 4) {
      const items = [...container.querySelectorAll("div")].filter(
        (el) => visible(el) && chineseOnlyText(el.innerText),
      );

      for (const item of items) {
        const text = item.innerText.trim();
        if (!byText.has(text)) byText.set(text, item);
      }

      if (byText.size === previousCount) stablePasses += 1;
      else stablePasses = 0;
      previousCount = byText.size;

      const before = container.scrollTop;
      container.scrollTop += Math.max(
        220,
        Math.floor(container.clientHeight * 0.75),
      );
      await sleep(350);
      if (container.scrollTop === before && stablePasses >= 1) break;
    }

    container.scrollTop = 0;
    await sleep(300);

    return [...byText.keys()];
  }

  function findSentenceItem(text) {
    const container = findMapContainer();
    if (!container) return null;
    return (
      [...container.querySelectorAll("div")].find(
        (el) => visible(el) && el.innerText?.trim() === text,
      ) || null
    );
  }

  async function clickSentenceItem(text) {
    const container = findMapContainer();
    if (!container) throw new Error("No map container while clicking.");

    for (let pass = 0; pass < 80; pass += 1) {
      const item = findSentenceItem(text);
      if (item) {
        item.scrollIntoView({ block: "center" });
        await sleep(150);
        item.click();
        return;
      }
      container.scrollTop += Math.max(
        180,
        Math.floor(container.clientHeight * 0.65),
      );
      await sleep(150);
    }

    throw new Error(`Could not find sentence item: ${text}`);
  }

  function scrapeCurrentSentence(fallbackChinese) {
    const pageText =
      document.querySelector(".tiptap.ProseMirror")?.innerText ||
      document.querySelector(".reveal-prompt")?.innerText ||
      document.body.innerText ||
      "";

    const lines = pageText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const chinese =
      lines.find((line) => fallbackChinese && line.includes(fallbackChinese)) ||
      fallbackChinese ||
      document.querySelector("h1, h2")?.innerText?.trim() ||
      document.title.replace(/\s*\|.*$/, "").trim() ||
      "";

    const chineseIndex = lines.findIndex((line) => line.includes(chinese));
    const english =
      chineseIndex >= 0
        ? lines
            .slice(chineseIndex + 1)
            .find((line) => /^[A-Za-z]/.test(line)) || ""
        : "";

    const audios = [...document.querySelectorAll("a, audio, source")]
      .map((el) => el.href || el.src || el.currentSrc)
      .filter((src) => src && /\.mp3(\?|$)/.test(src));

    return {
      chinese,
      english,
      audio1: audios[0] || "",
      audio2: audios[1] || "",
      rawText: pageText,
    };
  }

  function levelFilename(level) {
    return level
      ? `Level ${level} Sentences.csv`
      : `Traverse Sentences ${new Date().toISOString().slice(0, 10)}.csv`;
  }

  async function exportCurrentTraverseSentenceLevel(options = {}) {
    const { level = "", delay = 1200 } = options;
    const sentenceTexts = await collectSentenceItems();
    console.log(`Sentence items found: ${sentenceTexts.length}`);

    const rows = [];
    for (let i = 0; i < sentenceTexts.length; i += 1) {
      const text = sentenceTexts[i];
      console.log(`Scraping ${i + 1}/${sentenceTexts.length}: ${text}`);
      await clickSentenceItem(text);
      await sleep(delay);
      rows.push(scrapeCurrentSentence(text));
    }

    const filename = levelFilename(level);
    downloadCsv(toCsv(rows), filename);
    console.log(`Exported ${rows.length} rows to ${filename}`);
    console.log(rows.slice(0, 5));
    return rows;
  }

  return {
    exportCurrentTraverseSentenceLevel,
    collectSentenceItems,
    scrapeCurrentSentence,
  };
})();

window.exportCurrentTraverseSentenceLevel =
  TraverseSentenceExporter.exportCurrentTraverseSentenceLevel;
window.collectTraverseSentenceItems =
  TraverseSentenceExporter.collectSentenceItems;
