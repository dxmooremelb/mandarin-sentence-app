/*
  Traverse bulk crawler/exporter.

  Run this in the browser console while logged in to Traverse.

  Reliable mode, if you have sentence-level URLs:
    await scrapeTraverseSentenceUrls([
      { level: 27, url: "https://traverse.link/Mandarin_Blueprint/awmqk6ruwxb8u6wmlyq3e86f/?showMap=1" }
    ]);

  Experimental discovery mode, from a Traverse map page:
    await crawlTraverseFromCurrentPage({ maxDepth: 4 });

  Discovery can only visit pages linked from the maps your logged-in browser can see.
  It cannot guess private Traverse IDs that are not linked anywhere.
*/

const TraverseBulkCrawler = (() => {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const sameBlueprint = (url) => /^https:\/\/traverse\.link\/Mandarin_Blueprint\//.test(url || "");

  function downloadText(text, filename, mime = "text/plain;charset=utf-8") {
    const blob = new Blob([text], { type: mime });
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
      ...rows.map(row => [row.chinese, row.english, row.audio1, row.audio2, row.rawText]),
    ].map(row => row.map(csvEscape).join(",")).join("\n");
  }

  function safeName(value) {
    return String(value || "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90) || "Traverse Sentences";
  }

  function levelFilename(job, win) {
    if (job?.level) return `Level ${job.level} Sentences.csv`;
    const title = win?.document?.title?.replace(/\s*\|.*$/, "").trim();
    return `${safeName(title || "Traverse Sentences")} Sentences.csv`;
  }

  function visible(el, win = window) {
    return Boolean(el && el.offsetParent !== null && win.getComputedStyle(el).visibility !== "hidden");
  }

  function chineseOnlyText(text) {
    const value = String(text || "").trim();
    return value &&
      /[\u4e00-\u9fff]/.test(value) &&
      !/[a-zA-Z]/.test(value) &&
      value.length <= 90;
  }

  function findMapContainer(doc = document, win = window) {
    const candidates = [...doc.querySelectorAll("div")].filter(el => {
      const className = el.className?.toString() || "";
      const text = el.innerText || "";
      return visible(el, win) &&
        (className.includes("overflow-y-auto") || el.scrollHeight > el.clientHeight + 80) &&
        /[\u4e00-\u9fff]/.test(text);
    });

    return candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || null;
  }

  async function waitForTraverseReady(win, timeout = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try {
        const text = win.document?.body?.innerText || "";
        if (text && !/Study smarter with Traverse\s*Try it\s*Untitled/.test(text)) return true;
        if (findMapContainer(win.document, win)) return true;
      } catch {
        // The popup may be between navigations.
      }
      await sleep(350);
    }
    return false;
  }

  function openWorkerWindow() {
    const worker = window.open("about:blank", "traverse_bulk_export_worker", "width=1200,height=900");
    if (!worker) {
      throw new Error("Popup was blocked. Allow popups for traverse.link and run the command again.");
    }
    return worker;
  }

  async function loadWorkerUrl(worker, url) {
    worker.location.href = url;
    await waitForTraverseReady(worker);
    await sleep(1200);
  }

  async function collectSentenceItems(doc = document, win = window) {
    const container = findMapContainer(doc, win);
    if (!container) return [];

    const byText = new Map();
    let stablePasses = 0;
    let previousCount = 0;

    container.scrollTop = 0;
    await sleep(400);

    while (stablePasses < 5) {
      const items = [...container.querySelectorAll("div")]
        .filter(el => visible(el, win) && chineseOnlyText(el.innerText));

      for (const item of items) {
        const text = item.innerText.trim();
        if (!byText.has(text)) byText.set(text, item);
      }

      if (byText.size === previousCount) stablePasses += 1;
      else stablePasses = 0;
      previousCount = byText.size;

      const before = container.scrollTop;
      container.scrollTop += Math.max(240, Math.floor(container.clientHeight * 0.75));
      await sleep(300);
      if (container.scrollTop === before && stablePasses >= 1) break;
    }

    container.scrollTop = 0;
    await sleep(250);
    return [...byText.keys()];
  }

  function findSentenceItem(text, doc = document, win = window) {
    const container = findMapContainer(doc, win);
    if (!container) return null;
    return [...container.querySelectorAll("div")]
      .find(el => visible(el, win) && el.innerText?.trim() === text) || null;
  }

  async function clickSentenceItem(text, doc = document, win = window) {
    const container = findMapContainer(doc, win);
    if (!container) throw new Error("No sentence map container found.");

    container.scrollTop = 0;
    await sleep(120);

    for (let pass = 0; pass < 100; pass += 1) {
      const item = findSentenceItem(text, doc, win);
      if (item) {
        item.scrollIntoView({ block: "center" });
        await sleep(120);
        item.click();
        return;
      }
      container.scrollTop += Math.max(180, Math.floor(container.clientHeight * 0.65));
      await sleep(120);
    }

    throw new Error(`Could not find sentence item: ${text}`);
  }

  function scrapeCurrentSentence(fallbackChinese, doc = document) {
    const pageText =
      doc.querySelector(".tiptap.ProseMirror")?.innerText ||
      doc.querySelector(".reveal-prompt")?.innerText ||
      doc.body?.innerText ||
      "";

    const lines = pageText
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);

    const chinese =
      lines.find(line => fallbackChinese && line.includes(fallbackChinese)) ||
      fallbackChinese ||
      doc.querySelector("h1, h2")?.innerText?.trim() ||
      doc.title.replace(/\s*\|.*$/, "").trim() ||
      "";

    const chineseIndex = lines.findIndex(line => line.includes(chinese));
    const english = chineseIndex >= 0
      ? lines.slice(chineseIndex + 1).find(line => /^[A-Za-z]/.test(line)) || ""
      : "";

    const audios = [...doc.querySelectorAll("a, audio, source")]
      .map(el => el.href || el.src || el.currentSrc)
      .filter(src => src && /\.mp3(\?|$)/.test(src));

    return {
      chinese,
      english,
      audio1: audios[0] || "",
      audio2: audios[1] || "",
      rawText: pageText,
    };
  }

  async function scrapeSentenceLevelInWindow(worker, job = {}) {
    const items = await collectSentenceItems(worker.document, worker);
    if (!items.length) {
      throw new Error(`No sentence cards found at ${worker.location.href}`);
    }

    const rows = [];
    for (let i = 0; i < items.length; i += 1) {
      const text = items[i];
      console.log(`Scraping ${i + 1}/${items.length}: ${text}`);
      await clickSentenceItem(text, worker.document, worker);
      await sleep(job.delay || 1200);
      rows.push(scrapeCurrentSentence(text, worker.document));
    }

    return rows;
  }

  async function scrapeTraverseSentenceUrls(jobs, options = {}) {
    if (!Array.isArray(jobs) || !jobs.length) {
      throw new Error("Pass an array like [{ level: 27, url: 'https://traverse.link/...' }].");
    }

    const worker = openWorkerWindow();
    const manifest = [];

    for (const job of jobs) {
      if (!sameBlueprint(job.url)) throw new Error(`Not a Mandarin Blueprint Traverse URL: ${job.url}`);
      console.log(`Opening ${job.level ? `Level ${job.level}` : job.url}`);
      await loadWorkerUrl(worker, job.url);
      const rows = await scrapeSentenceLevelInWindow(worker, {...options, ...job});
      const filename = levelFilename(job, worker);
      downloadText("\uFEFF" + toCsv(rows), filename, "text/csv;charset=utf-8");
      manifest.push({ filename, url: job.url, rows: rows.length });
      console.log(`Downloaded ${filename} (${rows.length} rows)`);
      await sleep(options.betweenLevelsDelay || 800);
    }

    downloadText(JSON.stringify(manifest, null, 2), "traverse-export-manifest.json", "application/json;charset=utf-8");
    return manifest;
  }

  function collectSameSiteLinks(doc = document) {
    return [...new Set(
      [...doc.querySelectorAll("a[href]")]
        .map(a => a.href)
        .filter(sameBlueprint)
        .map(url => url.replace(/#.*$/, ""))
    )];
  }

  async function crawlTraverseFromCurrentPage(options = {}) {
    const maxDepth = Number(options.maxDepth || 3);
    const queue = [{ url: location.href, depth: 0 }];
    const seen = new Set();
    const sentenceJobs = [];
    const worker = openWorkerWindow();

    while (queue.length) {
      const current = queue.shift();
      if (!current || seen.has(current.url) || current.depth > maxDepth) continue;
      seen.add(current.url);

      console.log(`Crawling depth ${current.depth}: ${current.url}`);
      await loadWorkerUrl(worker, current.url);

      const sentenceItems = await collectSentenceItems(worker.document, worker);
      const looksLikeSentenceLevel = sentenceItems.length >= Number(options.minSentenceCards || 20);
      if (looksLikeSentenceLevel) {
        sentenceJobs.push({ url: worker.location.href, level: options.levels?.[worker.location.href] || "" });
        console.log(`Queued sentence level: ${worker.location.href} (${sentenceItems.length} cards)`);
      }

      const links = collectSameSiteLinks(worker.document);
      for (const link of links) {
        if (!seen.has(link)) queue.push({ url: link, depth: current.depth + 1 });
      }
    }

    const manifest = {
      discoveredUrls: [...seen],
      sentenceJobs,
      note: "If sentenceJobs is empty, Traverse did not expose crawlable links from the starting page. Use scrapeTraverseSentenceUrls with known sentence-level URLs.",
    };

    downloadText(JSON.stringify(manifest, null, 2), "traverse-crawl-discovery.json", "application/json;charset=utf-8");
    console.log(manifest);

    if (options.scrape && sentenceJobs.length) {
      return scrapeTraverseSentenceUrls(sentenceJobs, options);
    }
    return manifest;
  }

  return {
    scrapeTraverseSentenceUrls,
    crawlTraverseFromCurrentPage,
    collectSentenceItems,
    scrapeCurrentSentence,
  };
})();

window.scrapeTraverseSentenceUrls = TraverseBulkCrawler.scrapeTraverseSentenceUrls;
window.crawlTraverseFromCurrentPage = TraverseBulkCrawler.crawlTraverseFromCurrentPage;
window.collectTraverseSentenceItems = TraverseBulkCrawler.collectSentenceItems;
