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

  // Browser text assist (autofill history, autocorrect, spelling suggestions)
  // reads as a website. Text fields are opted out as they mount; inputs backed
  // by a same-app datalist keep their intentional suggestions.
  const TEXT_FIELDS = [
    "input:not([type]):not([list])",
    'input[type="text"]:not([list])',
    'input[type="search"]:not([list])',
    'input[type="url"]:not([list])',
    'input[type="tel"]:not([list])',
    'input[type="email"]:not([list])',
    'input[type="password"]:not([list])',
    "textarea",
  ].join(",");
  const optOut = (field) => {
    field.setAttribute("autocomplete", "off");
    field.setAttribute("autocorrect", "off");
    field.setAttribute("autocapitalize", "off");
    field.setAttribute("spellcheck", "false");
  };
  const configure = (root) => {
    if (root instanceof Element && root.matches(TEXT_FIELDS)) optOut(root);
    for (const field of root.querySelectorAll(TEXT_FIELDS)) optOut(field);
  };
  const watchTextFields = () => {
    configure(document);
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) configure(node);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchTextFields, { once: true });
  } else {
    watchTextFields();
  }
})();
