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
    if (form.elements.tag?.checked) await tagUntagged();
  });

  // Tag suggestions for bookmarks without tags, when the tagger is on. The
  // Worker tags one batch per call, so this asks until nothing is left.
  const tagForm = document.querySelector("#tag-untagged");
  const tagStatus = document.querySelector("#tag-status");
  let tagging = false;

  async function tagUntagged() {
    if (tagging) return;
    tagging = true;
    tagStatus.textContent = "Tagging";
    let asked = 0;
    let tagged = 0;
    for (let after = 0; ; ) {
      const res = await fetch("/api/tag", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ after }),
      }).catch(() => null);
      if (!res?.ok) {
        tagStatus.textContent = `Tagging stopped after ${tagged} bookmarks. Press the button to carry on with the rest.`;
        break;
      }
      const batch = await res.json();
      asked += batch.asked;
      tagged += batch.tagged;
      after = batch.next;
      if (!batch.left) {
        // Finished: say which of the three ways it ended, since "tagged 0" alone reads like a failure.
        tagStatus.textContent = !asked
          ? "Every bookmark already has a tag, so there was nothing to do."
          : !tagged
            ? `The model suggested no tags for the ${asked} bookmarks without any.`
            : `Done. Tagged ${tagged} of ${asked} bookmarks without tags. Reload the page to see them.`;
        break;
      }
      tagStatus.textContent = `Tagging, ${batch.left} left`;
    }
    tagging = false;
  }

  tagForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    tagUntagged();
  });
})();
