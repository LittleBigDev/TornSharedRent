// ==UserScript==
// @name         TornSharedRent
// @namespace    littlebigdev.tornsharedrent
// @version      0.2
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
    const panels = {
      info: el("div", {}, [info]),
      settings: settingsPanel(),
    };
    const tabs = Object.keys(panels).map((name) => el("button", {
      textContent: name === "info" ? "Info" : "Settings",
      className: "tsr-tab",
      onclick: () => show(name),
    }));
    const root = el("div", { id: BOX_ID }, [el("div", { className: "tsr-tabs" }, tabs), ...Object.values(panels)]);
    function show(name) {
      Object.entries(panels).forEach(([n, p], i) => {
        p.hidden = n !== name;
        tabs[i].classList.toggle("tsr-active", n === name);
      });
    }
    show(tab);
    return root;
  }

  function settingsPanel() {
    const input = el("input", { type: "password", value: GM_getValue("my_key", ""), placeholder: "API key", size: 20 });
    const status = el("span");
    const save = el("button", {
      textContent: "Save",
      onclick: async () => {
        const key = input.value.trim();
        try {
          await api("v2/user/property", key);
          GM_setValue("my_key", key);
          home = undefined;
          render();
        } catch (e) {
          status.textContent = ` ✕ ${e.message}`;
        }
      },
    });
    return el("div", {}, [
      el("label", { textContent: "My key " }), input, " ", save, status,
      el("div", {}, [el("a", { href: MY_KEY_LINK, target: "_blank", textContent: "Create my key" })]),
    ]);
  }

  async function render() {
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
    document.querySelector(".content-wrapper")?.prepend(content);
  }

  const style = document.createElement("style");
  style.textContent = `
    #${BOX_ID} { margin: 10px 0; padding: 8px 10px; border-radius: 5px; background: var(--default-bg-panel-color, #f2f2f2); color: var(--default-color, #333); }
    #${BOX_ID} .tsr-tabs { margin-bottom: 8px; }
    #${BOX_ID} .tsr-tab { margin-right: 6px; padding: 2px 10px; cursor: pointer; }
    #${BOX_ID} .tsr-active { font-weight: bold; }
    #${BOX_ID} input { margin: 0 4px; }
  `;
  document.head.append(style);

  window.addEventListener("hashchange", render);
  render();
})();
