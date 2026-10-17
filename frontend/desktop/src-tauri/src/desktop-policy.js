// Native windows only. The browser UI and public Bridge pages retain their own behavior.
(() => {
  window.addEventListener("contextmenu", (event) => event.preventDefault(), true);
  window.addEventListener(
    "keydown",
    (event) => {
      const key = event.key.toLowerCase();
      const primary = event.ctrlKey || event.metaKey;
      const browserCommand =
        primary && ["i", "j", "u", "r", "p", "s", "o", "l", "n", "t", "w", "f"].includes(key);
      const inspect = primary && (event.shiftKey || (event.metaKey && event.altKey)) && key === "c";
      const navigation =
        (event.altKey && !primary && ["arrowleft", "arrowright"].includes(key)) ||
        (event.metaKey && ["[", "]"].includes(key)) ||
        ["browserback", "browserforward"].includes(key);
      if (["f5", "f11", "f12"].includes(key) || browserCommand || inspect || navigation) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
})();
