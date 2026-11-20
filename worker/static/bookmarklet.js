// The bookmarklet on the Settings page: these lines joined into one, with this
// site's address in place of ORIGIN. It runs inside the page being saved, the
// one place that can read the icon of a site the Worker cannot reach, and
// hands that icon to the window it opens when the window asks for it.
// No line comments below this one: a bookmarklet is a single line.
(() => {
  const marks = "ORIGIN";
  const enc = encodeURIComponent;
  const popup = window.open(marks + "/add?popup=1&url=" + enc(location.href) + "&title=" + enc(document.title), "marks", "width=480,height=640");
  const size = (e) => parseInt(e.getAttribute("sizes")) || (e.rel.includes("apple") ? 180 : 32);
  const named = [...document.querySelectorAll("link[rel~=icon],link[rel^=apple-touch-icon]")]
    .filter((e) => e.getAttribute("href"))
    .sort((a, b) => size(b) - size(a))
    .map((e) => e.href);
  const icon = (async () => {
    for (const url of [...named.slice(0, 3), location.origin + "/favicon.ico"]) {
      try {
        const res = await fetch(url);
        if (res.ok) return await res.blob();
      } catch {}
    }
  })();
  addEventListener("message", async (e) => {
    if (e.source === popup && e.origin === marks && e.data === "marks:icon") popup.postMessage({ icon: await icon }, marks);
  });
})();
