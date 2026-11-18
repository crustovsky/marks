// The only script the pages load. Everything works without it except drag to
// reorder, the tag picker and tag suggestions.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  // "/" jumps to the search box.
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "");
    const box = $(".search input");
    if (e.key === "/" && !typing && box) {
      e.preventDefault();
      box.focus();
    }
  });

  // The bookmarklet's window closes itself once the bookmark is saved.
  if (document.body.dataset.done) window.close();
  $("[data-close]")?.addEventListener("click", () => window.close());

  for (const form of document.querySelectorAll("form[data-confirm]")) {
    form.addEventListener("submit", (e) => {
      if (!confirm(form.dataset.confirm)) e.preventDefault();
    });
  }

  // Quick access: Edit turns the tiles into something to drag and remove.
  const grid = $("#quick");
  const edit = $("#quick-edit");
  if (grid && edit) {
    let sortable;
    const saveOrder = () =>
      fetch("/api/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...grid.children].map((el) => Number(el.dataset.id)) }),
      })
        .then((r) => r.ok || Promise.reject())
        // Most likely the Access session ran out; a reload leads to the sign-in.
        .catch(() => location.reload());
    edit.addEventListener("click", async () => {
      const on = document.body.classList.toggle("editing");
      edit.textContent = on ? "Done" : "Edit";
      if (on && !sortable) {
        await loadScript("/sortable.js");
        sortable = new Sortable(grid, { animation: 150, onEnd: saveOrder });
      }
      sortable?.option("disabled", !on);
    });
    // While editing, a tap on a tile must not open it.
    grid.addEventListener("click", (e) => {
      if (document.body.classList.contains("editing") && !e.target.closest("button")) e.preventDefault();
    });
  }

  // Add and edit form: tag buttons toggle a tag in the text field.
  const tags = $("#tags");
  const pick = $("#pick");
  if (tags && pick) {
    const current = () => tags.value.split(/[\s,]+/).filter(Boolean);
    const paint = () => {
      const have = new Set(current());
      for (const b of pick.children) b.classList.toggle("on", have.has(b.dataset.tag));
    };
    pick.addEventListener("click", (e) => {
      const tag = e.target.closest("[data-tag]")?.dataset.tag;
      if (!tag) return;
      const have = current();
      tags.value = (have.includes(tag) ? have.filter((t) => t !== tag) : [...have, tag]).join(" ");
      paint();
    });
    tags.addEventListener("input", paint);
    paint();

    // Suggested tags come first, outlined, and are not applied until tapped.
    if (tags.dataset.suggest) {
      const form = tags.form;
      const query = new URLSearchParams({ url: form.url.value, title: form.title.value });
      fetch(`/api/suggest?${query}`)
        .then((r) => r.json())
        .then(({ tags: suggested }) => {
          for (const tag of suggested.reverse()) {
            const old = [...pick.children].find((b) => b.dataset.tag === tag);
            const button = old ?? Object.assign(document.createElement("button"), { type: "button", textContent: tag });
            button.dataset.tag = tag;
            button.classList.add("tag", "suggested");
            pick.prepend(button);
          }
          paint();
        })
        .catch(() => {});
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement("script"), { src, onload: resolve, onerror: reject });
      document.head.append(s);
    });
  }
})();
