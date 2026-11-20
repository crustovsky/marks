// The only script the pages load. Everything works without it except drag to
// reorder, the tag picker, tag suggestions and, in select mode, ticking a whole
// page or a range at once and the count of what is ticked.
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

  // The bookmarklet's window, for a bookmark whose icon the Worker cannot
  // fetch: ask the page that opened the window for it. The answer goes into a
  // hidden file field and is saved like an upload. The question says nothing,
  // so any opener may hear it; the server checks what comes back.
  const carry = $("#carry");
  if (carry && window.opener) {
    addEventListener("message", (e) => {
      const icon = e.source === window.opener && e.data?.icon;
      // The server has the same limit.
      if (!(icon instanceof Blob) || icon.size > 200 * 1024) return;
      const files = new DataTransfer();
      files.items.add(new File([icon], "icon", { type: icon.type }));
      carry.files = files.files;
      $("#carried").hidden = false;
    });
    window.opener.postMessage("marks:icon", "*");
  }

  for (const form of document.querySelectorAll("form[data-confirm]")) {
    form.addEventListener("submit", (e) => {
      if (!confirm(form.dataset.confirm)) e.preventDefault();
    });
  }

  // Select mode: a button ticks or unticks the whole page, and a click with
  // Shift held gives every row since the last click the same tick.
  const tickAll = $("#tick-all");
  if (tickAll) {
    const boxes = () => [...document.querySelectorAll(".tick input")];
    const ticked = $("#ticked");
    let last;
    tickAll.hidden = false;
    ticked.hidden = false;
    // With everything on one page the button does what "apply to all" would.
    $("[data-one-page]")?.remove();
    const all = $('#bulk [name="all"]');
    // How many bookmarks the next press of a button will change.
    const count = () => {
      ticked.textContent = all?.checked ? `all ${all.dataset.total} chosen` : `${boxes().filter((b) => b.checked).length} ticked`;
    };
    tickAll.addEventListener("click", () => {
      const on = !boxes().every((b) => b.checked);
      for (const b of boxes()) b.checked = on;
      count();
    });
    document.addEventListener("click", (e) => {
      const box = e.target.closest?.(".tick input");
      if (!box) return;
      if (e.shiftKey && last) {
        const rows = boxes();
        const [from, to] = [rows.indexOf(last), rows.indexOf(box)].sort((a, b) => a - b);
        for (const b of rows.slice(from, to + 1)) b.checked = box.checked;
      }
      last = box;
    });
    document.addEventListener("change", count);
    count();
  }

  // Quick access: tiles can be dragged into a new order with the mouse at any
  // time. Edit adds the buttons to remove a tile or fetch its icon again, and is
  // how a finger drags, where a long press on a link belongs to the browser.
  const grid = $("#quick");
  const edit = $("#quick-edit");
  if (grid && edit) {
    const editing = () => document.body.classList.contains("editing");
    let sortable;
    let loading;
    const saveOrder = () =>
      fetch("/api/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...grid.children].map((el) => Number(el.dataset.id)) }),
      })
        .then((r) => r.ok || Promise.reject())
        // Most likely the Access session ran out; a reload leads to the sign-in.
        .catch(() => location.reload());
    // The drag library is loaded when the mouse first reaches the tiles, or on Edit.
    const arm = () =>
      (loading ??= loadScript("/sortable.js").then(() => {
        sortable = new Sortable(grid, { animation: 150, onEnd: saveOrder });
      }));
    grid.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && arm());
    // Decided on every press, before the library sees it: a mouse always drags, anything else only while editing.
    grid.addEventListener("pointerdown", (e) => sortable?.option("disabled", e.pointerType !== "mouse" && !editing()), true);
    edit.addEventListener("click", async () => {
      const on = document.body.classList.toggle("editing");
      edit.textContent = on ? "Done" : "Edit";
      if (on) await arm();
    });
    // While editing, a tap on a tile must not open it.
    grid.addEventListener("click", (e) => {
      if (editing() && !e.target.closest("button")) e.preventDefault();
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

    // "+" turns into a small field for a tag that is not among the buttons yet.
    // Enter or leaving the field adds it, Escape gives up.
    const plus = $("#new-tag");
    if (plus) {
      plus.hidden = false;
      plus.addEventListener("click", () => {
        const box = Object.assign(document.createElement("input"), { type: "text", className: "tag new", placeholder: "new tag", autocapitalize: "off" });
        box.setAttribute("aria-label", "New tag");
        let open = true;
        const close = (keep) => {
          if (!open) return;
          open = false;
          // The same cleaning as the server, which cleans again on save.
          const tag = keep ? box.value.toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 32) : "";
          box.remove();
          plus.hidden = false;
          if (!tag) return;
          if (![...pick.children].some((b) => b.dataset.tag === tag)) {
            const button = Object.assign(document.createElement("button"), { type: "button", className: "tag", textContent: tag });
            button.dataset.tag = tag;
            plus.before(button);
          }
          if (!current().includes(tag)) tags.value = [...current(), tag].join(" ");
          paint();
        };
        box.addEventListener("keydown", (e) => {
          // Enter must not save the whole form.
          if (e.key === "Enter") e.preventDefault();
          if (e.key === "Enter" || e.key === "Escape") {
            close(e.key === "Enter");
            plus.focus();
          }
        });
        box.addEventListener("blur", () => close(true));
        plus.hidden = true;
        plus.before(box);
        box.focus();
      });
    }

    // Suggested tags come first, outlined, and are not applied until tapped.
    // A new bookmark asks for them when the form opens, an existing one when
    // its button is pressed, for the address and title as they stand in the form.
    const ask = $("#suggest");
    const suggest = () => {
      const form = tags.form;
      const query = new URLSearchParams({ url: form.url.value, title: form.title.value });
      return fetch(`/api/suggest?${query}`)
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
          return suggested.length;
        })
        .catch(() => 0);
    };
    if (tags.dataset.suggest) suggest();
    if (ask) {
      ask.hidden = false;
      ask.addEventListener("click", async () => {
        ask.disabled = true;
        ask.textContent = "Asking";
        ask.textContent = (await suggest()) ? "Suggest tags" : "No suggestions";
        ask.disabled = false;
      });
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement("script"), { src, onload: resolve, onerror: reject });
      document.head.append(s);
    });
  }
})();
