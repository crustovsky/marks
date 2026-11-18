// Loaded on the Settings page only. Reads a browser's bookmarks export here, in
// the browser, which has a real HTML parser and no CPU limit, and sends what it
// finds to the Worker in batches. What counts as a duplicate, which folders
// become tags and how addresses are cleaned is decided there.
(() => {
  const BATCH = 500;
  const form = document.querySelector("#import");
  const status = document.querySelector("#import-status");

  // Every link with the names of the folders it sits in, outermost first.
  function readBookmarks(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return [...doc.querySelectorAll("a[href]")].map((a) => {
      const folders = [];
      for (let dl = a.closest("dl"); dl; dl = dl.parentElement?.closest("dl")) {
        const heading = dl.previousElementSibling;
        if (heading?.tagName === "H3") folders.unshift(heading.textContent.trim());
      }
      return { url: a.getAttribute("href"), title: a.textContent.trim(), folders, created: Number(a.getAttribute("add_date")) || 0 };
    });
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = form.elements.file.files[0];
    if (!file) return;
    const items = readBookmarks(await file.text());
    let added = 0;
    for (let i = 0; i < items.length; i += BATCH) {
      status.textContent = `Importing, ${i} of ${items.length} done`;
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: items.slice(i, i + BATCH) }),
      }).catch(() => null);
      if (!res?.ok) {
        status.textContent = `Import stopped after ${i} of ${items.length}. Reload the page and try again; nothing is added twice.`;
        return;
      }
      added += (await res.json()).added;
    }
    status.textContent = `Imported ${added} new bookmarks out of ${items.length} links in the file.`;
  });
})();
