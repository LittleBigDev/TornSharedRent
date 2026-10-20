// ==UserScript==
// @name         TornSharedRent
// @namespace    littlebigdev.tornsharedrent
// @version      0.12
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
  const WRAP_ID = "tsr-wrap"; // the box and the Torn separator above it
  const MY_KEY_LINK = "https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=coloc&user=property,profile,log&logIds=89,112";
  const SPOUSE_KEY_LINK = "https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=coloc-conjoint&user=log&logIds=89";

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

  // Log entries of one category since a date, newest first. The API pages backwards with `to`
  async function logs(key, cat, from) {
    const seen = new Map();
    let to = "";
    for (;;) {
      const page = (await api(`v2/user/log?cat=${cat}&limit=100&from=${from}${to}`, key)).log;
      const fresh = page.filter((l) => !seen.has(l.id));
      fresh.forEach((l) => seen.set(l.id, l));
      if (page.length < 100 || !fresh.length) return [...seen.values()];
      to = `&to=${page[page.length - 1].timestamp}`;
    }
  }

  const PAYMENTS = {
    5936: ["Rent", (d) => d.rent],
    5942: ["Lease extension", (d) => d.rent],
    5920: ["Upkeep", (d) => d.upkeep_paid],
  };

  // Payments for the home made by the owner of `key`
  async function payments(key, homeId, from, who) {
    return (await logs(key, 89, from))
      .filter((l) => PAYMENTS[l.details.id] && l.data.property_id === homeId)
      .map((l) => ({ at: l.timestamp, who, what: PAYMENTS[l.details.id][0], amount: PAYMENTS[l.details.id][1](l.data) }));
  }

  const tag = (homeId) => `[TSR-${homeId}]`;

  // Pay-backs between the spouses, from my own money log: only transfers whose message carries the home's tag
  async function paybacks(key, homeId, from, spouseId) {
    return (await logs(key, 112, from))
      .filter((l) => (l.data.message || "").includes(tag(homeId))
        && (l.data.receiver === spouseId || l.data.sender === spouseId))
      .map((l) => ({ at: l.timestamp, who: l.details.id === 4800 ? "me" : "spouse", what: "Pay-back", amount: l.data.money, payback: true }));
  }

  // What the spouse owes me (negative: what I owe). A payment by one is owed by the other for their share;
  // a pay-back cancels that much debt.
  function balance(moves, myShare) {
    return moves.reduce((sum, m) => {
      const mine = m.who === "me";
      if (m.payback) return sum + (mine ? m.amount : -m.amount);
      return sum + (mine ? m.amount * (1 - myShare) : -m.amount * myShare);
    }, 0);
  }

  const money = (n) => "$" + Math.round(n).toLocaleString("en-US");

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
    const field = (name, props) => el("input", { value: GM_getValue(name, ""), ...props });
    const myKey = field("my_key", { type: "password", placeholder: "API key" });
    const spouseKey = field("spouse_key", { type: "password", placeholder: "API key" });
    const share = el("input", { type: "number", min: 0, max: 100, value: GM_getValue("my_share", 50), className: "tsr-short" });
    const since = field("since", { type: "date" });
    const status = el("span", { className: "tsr-bad" });
    const save = el("button", {
      type: "button",
      className: "tsr-btn is-primary",
      textContent: "Save",
      onclick: async () => {
        status.textContent = "";
        try {
          const h = (await api("v2/user/property", myKey.value.trim())).property;
          const me = (await api("v2/user/profile", myKey.value.trim())).profile.id;
          if (spouseKey.value.trim()) {
            const them = (await api("v2/user/profile", spouseKey.value.trim())).profile.id;
            if (them === me || !h.used_by.some((u) => u.id === them)) throw new Error("This spouse key belongs to nobody living in your home.");
          }
          GM_setValue("my_key", myKey.value.trim());
          GM_setValue("spouse_key", spouseKey.value.trim());
          GM_setValue("my_share", Math.min(100, Math.max(0, Number(share.value) || 50)));
          GM_setValue("since", since.value);
          home = undefined;
          render();
        } catch (err) {
          status.textContent = err.message;
        }
      },
    });
    return el("div", { className: "tsr-pane" }, [
      row("My key", ["Reads your home, profile, property and money logs. ",
        el("a", { href: MY_KEY_LINK, target: "_blank", textContent: "Create my key" })], [myKey]),
      row("Spouse key", ["The key your spouse created for you, reading only their property log. They create it with ",
        el("a", { href: SPOUSE_KEY_LINK, target: "_blank", textContent: "this link" }), "."], [spouseKey]),
      row("My share", ["Part of the home expenses I pay, in %. Your spouse sets the rest in their own script."], [share, "%"]),
      row("Tracking since", ["Payments before this date are ignored. Empty: everything the logs still hold."], [since]),
      el("div", { className: "tsr-foot" }, [status, save]),
    ]);
  }

  // Box to keep on the page: Torn redraws the property view on its own, so it is put back whenever it gets dropped.
  // Below the property panel (info view, or options view such as upkeep), else below the page title.
  // Torn also redraws the view after an action on the page (upkeep paid...): the box is then refreshed,
  // a bit later so the payment has reached the logs.
  let shown = null;
  let refresh = null;
  function place() {
    if (!shown) return;
    const anchor = document.querySelector("#properties-page-wrap > .property-info, #properties-page-wrap > .property-option > .property-info-cont")
      ?? document.querySelector("#properties-page-wrap .content-title");
    if (!anchor || shown.previousElementSibling === anchor) return;
    if (shown.dataset.placed && !shown.isConnected) {
      clearTimeout(refresh);
      refresh = setTimeout(render, 2000);
    }
    anchor.after(shown);
    shown.dataset.placed = "1";
  }

  async function infoPane(h) {
    const me = (await api("v2/user/profile", GM_getValue("my_key"))).profile.id;
    const spouse = h.used_by.find((u) => u.id !== me);
    if (!spouse) return el("div", {}, ["Nobody shares this home with you."]);
    const from = GM_getValue("since") ? Date.parse(GM_getValue("since")) / 1000 : 0;
    const spouseKey = GM_getValue("spouse_key", "");
    const moves = [
      ...await payments(GM_getValue("my_key"), h.id, from, "me"),
      ...(spouseKey ? await payments(spouseKey, h.id, from, "spouse") : []),
      ...await paybacks(GM_getValue("my_key"), h.id, from, spouse.id),
    ].sort((a, b) => b.at - a.at);

    const owed = balance(moves, GM_getValue("my_share", 50) / 100);
    const headline = Math.abs(owed) < 1 ? "You are square."
      : owed > 0 ? `${spouse.name} owes you ${money(owed)}` : `You owe ${spouse.name} ${money(-owed)}`;
    const date = (at) => new Date(at * 1000).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    return el("div", {}, [
      el("div", { className: "tsr-balance", textContent: headline }),
      spouseKey ? "" : el("div", { className: "tsr-bad", textContent: "Add your spouse's key in Settings: their payments are missing." }),
      el("table", { className: "tsr-moves" }, moves.slice(0, 10).map((m) => el("tr", {}, [
        el("td", { textContent: date(m.at) }),
        el("td", { textContent: m.who === "me" ? "You" : spouse.name }),
        el("td", { textContent: m.what + (m.payback ? " ↩" : "") }),
        el("td", { className: "tsr-num", textContent: money(m.amount) }),
      ]))),
    ]);
  }

  async function render() {
    shown = null;
    document.getElementById(WRAP_ID)?.remove();
    const id = shownPropertyId();
    if (!id) return;

    const key = GM_getValue("my_key", "");
    let content;
    if (!key) {
      // ponytail: without a key the home can't be checked, so the box shows on every property page until one is saved
      content = box("settings", "Save your API key to detect the home you live in.");
    } else {
      try {
        const h = await currentHome(key);
        if (h.id !== id) return;
        content = box("info", await infoPane(h));
      } catch (e) {
        content = box("settings", `API error: ${e.message}`);
      }
    }
    if (shownPropertyId() !== id) return; // hash changed while waiting for the API
    document.getElementById(WRAP_ID)?.remove();
    shown = el("div", { id: WRAP_ID }, [el("hr", { className: "page-head-delimiter m-top10 m-bottom10" }), content]);
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
    #${BOX_ID} .tsr-row + .tsr-row { margin-top: 10px; }
    #${BOX_ID} input.tsr-short { width: 70px; }
    #${BOX_ID} .tsr-foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 12px; }
    #${BOX_ID} .tsr-balance { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
    #${BOX_ID} table.tsr-moves { width: 100%; border-collapse: collapse; font-size: 12px; }
    #${BOX_ID} .tsr-moves td { padding: 4px 6px; border-top: 1px solid var(--tsr-line); }
    #${BOX_ID} .tsr-num { text-align: right; font-variant-numeric: tabular-nums; }
    #${BOX_ID} .tsr-bad { display: block; color: var(--tsr-bad); font-size: 12px; }
    #${BOX_ID} .tsr-bad:empty { display: none; }
  `;
  document.head.append(style);

  new MutationObserver(place).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("hashchange", render);
  render();
})();
