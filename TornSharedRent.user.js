// ==UserScript==
// @name         TornSharedRent
// @namespace    littlebigdev.tornsharedrent
// @version      0.6
// @description  Shared home expenses between spouses: who paid what for the home you live in, and who owes whom.
// @match        https://www.torn.com/properties.php*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @run-at       document-idle
// @noframes
// @downloadURL  https://raw.githubusercontent.com/LittleBigDev/TornSharedRent/main/TornSharedRent.user.js
// @updateURL    https://raw.githubusercontent.com/LittleBigDev/TornSharedRent/main/TornSharedRent.user.js
// ==/UserScript==

(function () {
  "use strict";

  const BOX_ID = "tsr-box";
  const MY_KEY_LINK = "https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=coloc&user=property,profile,log&logIds=89,112";

  function api(path, key) {
    return new Promise((ok, ko) => GM_xmlhttpRequest({
      method: "GET",
      url: `https://api.torn.com/${path}${path.includes("?") ? "&" : "?"}key=${key}`,
      onload: (r) => {
        const d = JSON.parse(r.responseText);
        d.error ? ko(new Error(d.error.error)) : ok(d);
      },
      onerror: () => ko(new Error("network error")),
    }));
  }

  // Property shown on the page, from any of its views: #/p=propertyinfo&profile=1&ID=6345319, #/p=options&ID=6345319&tab=upkeep...
  function shownPropertyId() {
    return Number(new URLSearchParams(location.hash.replace(/^#\/?/, "")).get("ID")) || null;
  }

  // Property the player lives in, fetched once per page load (the properties page only changes its hash)
  let home;
  async function currentHome(key) {
    home ??= (await api("v2/user/property", key)).property;
    return home;
  }

  function el(tag, props = {}, children = []) {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...children);
    return e;
  }

  function box(tab, info) {
    const panes = {
      info: el("div", { className: "tsr-pane" }, [info]),
      settings: settingsPane(),
    };
    const tabs = Object.keys(panes).map((name) => el("button", {
      type: "button",
      className: "tsr-tab",
      textContent: name === "info" ? "Info" : "Settings",
      onclick: () => show(name),
    }));
    const root = el("div", { id: BOX_ID }, [
      el("div", { className: "tsr-head" }, ["Shared rent"]),
      el("div", { className: "tsr-tabs" }, tabs),
      ...Object.values(panes),
    ]);
    root.classList.toggle("tsr-dark", document.body.classList.contains("dark-mode"));
    function show(name) {
      Object.entries(panes).forEach(([n, p], i) => {
        p.classList.toggle("is-on", n === name);
        tabs[i].classList.toggle("is-on", n === name);
      });
    }
    show(tab);
    return root;
  }

  // One settings line: label and help on the left, controls on the right
  function row(label, help, controls) {
    return el("div", { className: "tsr-row" }, [
      el("div", { className: "tsr-row-text" }, [
        el("span", { className: "tsr-row-label", textContent: label }),
        el("span", { className: "tsr-row-help" }, help),
      ]),
      el("div", { className: "tsr-row-ctl" }, controls),
    ]);
  }

  function settingsPane() {
    const input = el("input", { type: "password", value: GM_getValue("my_key", ""), placeholder: "API key" });
    const status = el("span", { className: "tsr-bad" });
    const save = el("button", {
      type: "button",
      className: "tsr-btn is-primary",
      textContent: "Save",
      onclick: async () => {
        const key = input.value.trim();
        try {
          await api("v2/user/property", key);
          GM_setValue("my_key", key);
          home = undefined;
          render();
        } catch (e) {
          status.textContent = e.message;
        }
      },
    });
    return el("div", { className: "tsr-pane" }, [
      row("My key", ["Reads your home, profile and property and money logs. ",
        el("a", { href: MY_KEY_LINK, target: "_blank", textContent: "Create my key" })], [input, save]),
      status,
    ]);
  }

  // Box to keep on the page: Torn redraws the property view on its own, so it is put back whenever it gets dropped
  let shown = null;
  function place() {
    if (shown && !shown.isConnected) document.querySelector("#properties-page-wrap .content-title")?.after(shown);
  }

  async function render() {
    shown = null;
    document.getElementById(BOX_ID)?.remove();
    const id = shownPropertyId();
    if (!id) return;

    const key = GM_getValue("my_key", "");
    let content;
    if (!key) {
      // ponytail: without a key the home can't be checked, so the box shows on every property page until one is saved
      content = box("settings", "Save your API key to detect the home you live in.");
    } else {
      let h;
      try {
        h = await currentHome(key);
      } catch (e) {
        content = box("settings", `API error: ${e.message}`);
      }
      if (h && h.id !== id) return;
      content ??= box("info", `You live here (${h.used_by.map((u) => u.name).join(", ")}).`);
    }
    if (shownPropertyId() !== id) return; // hash changed while waiting for the API
    document.getElementById(BOX_ID)?.remove();
    shown = content;
    place();
  }

  const style = document.createElement("style");
  style.textContent = `
    #${BOX_ID} {
      --tsr-bg: #ffffff; --tsr-raise: #f4f6f8; --tsr-line: #dde3e9;
      --tsr-text: #10161c; --tsr-dim: #4a5763; --tsr-accent: #0d9488; --tsr-bad: #b91c1c;
      margin: 0 0 10px; border: 1px solid var(--tsr-line); border-radius: 10px; overflow: hidden;
      background: var(--tsr-bg); color: var(--tsr-text); font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    #${BOX_ID}.tsr-dark {
      --tsr-bg: #171d24; --tsr-raise: #1e262f; --tsr-line: #2c3742;
      --tsr-text: #e7edf3; --tsr-dim: #b3c0cd; --tsr-accent: #2dd4bf; --tsr-bad: #f87171;
    }
    #${BOX_ID} * { box-sizing: border-box; color: inherit; font-family: inherit; }
    #${BOX_ID} .tsr-head { padding: 8px 10px; font-weight: 700; color: var(--tsr-accent); background: var(--tsr-raise); }
    #${BOX_ID} .tsr-tabs { display: flex; gap: 2px; padding: 0 6px; background: var(--tsr-raise); border-bottom: 1px solid var(--tsr-line); }
    #${BOX_ID} .tsr-tab {
      appearance: none; border: 0; border-bottom: 2px solid transparent; border-radius: 8px 8px 0 0;
      background: transparent; color: var(--tsr-dim); font-size: 13px; font-weight: 600; padding: 7px 11px; cursor: pointer;
    }
    #${BOX_ID} .tsr-tab:hover { color: var(--tsr-text); }
    #${BOX_ID} .tsr-tab.is-on { color: var(--tsr-accent); border-bottom-color: var(--tsr-accent); background: var(--tsr-bg); }
    #${BOX_ID} .tsr-pane { display: none; padding: 10px; }
    #${BOX_ID} .tsr-pane.is-on { display: block; }
    #${BOX_ID} .tsr-row { display: flex; align-items: center; gap: 12px; }
    #${BOX_ID} .tsr-row-text { flex: 1 1 auto; min-width: 0; }
    #${BOX_ID} .tsr-row-label { display: block; font-weight: 600; }
    #${BOX_ID} .tsr-row-help { display: block; font-size: 11px; color: var(--tsr-dim); }
    #${BOX_ID} .tsr-row-ctl { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; }
    #${BOX_ID} a { color: var(--tsr-accent); }
    #${BOX_ID} input {
      height: 30px; width: 180px; padding: 0 8px; border: 1px solid var(--tsr-line); border-radius: 6px;
      background: var(--tsr-bg); color: var(--tsr-text); font-size: 13px;
    }
    #${BOX_ID} .tsr-btn {
      height: 30px; padding: 0 14px; border: 1px solid var(--tsr-line); border-radius: 6px;
      background: var(--tsr-raise); font-size: 13px; font-weight: 600; cursor: pointer;
    }
    #${BOX_ID} .tsr-btn.is-primary { background: var(--tsr-accent); border-color: var(--tsr-accent); color: #fff; }
    #${BOX_ID} .tsr-bad { display: block; color: var(--tsr-bad); font-size: 12px; }
    #${BOX_ID} .tsr-bad:empty { display: none; }
  `;
  document.head.append(style);

  new MutationObserver(place).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("hashchange", render);
  render();
})();
