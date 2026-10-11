'use strict';

/* The menu button (ui-clarity task 3): Actions ▾, Documents ▾, every ⋯, and
 * the editor's Move to. The APG menu button pattern, generalised from the
 * editor's Move to popover. Its CSS is css/menu.css.
 *
 * TWO WAYS IN
 *   LSCMenu.markup({ label, items }) returns the button and its hidden list
 *   as a string, for screens that render markup (the Project page, the
 *   Invoice screen). Items carry the screen's own data-act / data-doc
 *   attributes, so its delegated click handler runs them as before. With no
 *   items it returns '', so a menu with nothing to offer isn't drawn.
 *
 *   LSCMenu.open(opener, { label, items, onSelect, empty }) builds a menu on
 *   the spot, for lists that change each time (Move to's days), and calls
 *   onSelect(item) with the chosen item after closing.
 *
 * Items: { text, hint, danger, href, download, attrs: { 'data-act': … } },
 * or '-' for a divider. Falsy items are skipped, so a caller can write
 * `canSend && { … }`. Danger items always go last, below a divider (IA
 * Content Rules), wherever the caller put them.
 *
 * CHECKBOX ITEMS (trip-planner task 13, Calendars ▾): an item with
 * `checked: true|false` is a menuitemcheckbox, optionally with a colour
 * `swatch` ('#rrggbb'). Choosing one flips it in place and calls
 * onSelect(item, checked) with the menu left open, so several can be set in
 * one visit; Esc or a click outside closes it. On a phone the sheet's last
 * row says Done instead of Cancel. For open() menus only.
 *
 * WHILE OPEN the list lives in <body>, so no table's overflow or panel's
 * stacking clips it. A chosen declarative item is put back where it came
 * from first and clicked there, so the click bubbles through the screen
 * exactly as a click on a visible button would.
 *
 * BELOW 768px it opens as a bottom sheet: 48px rows, a Cancel row, a
 * backdrop, Tab kept inside it (the modal trap) and #app-view inert behind
 * it. Esc, Cancel and the backdrop close it and return focus to the button. */

const LSCMenu = (() => {
  const PHONE = window.matchMedia('(max-width: 767px)');
  const TYPEAHEAD_MS = 500;
  const esc = (s) => LSCUtil.esc(s);

  let seq = 0;
  // The one open menu: its button, its list, where the list lives when
  // closed (declarative only), the sheet's backdrop, and the caller's onSelect.
  let cur = null;
  let typed = '';
  let typedAt = 0;

  // ── Markup ──
  /* Drops falsy items, moves danger items last below a divider, and tidies
     dividers (none first, last or twice). */
  function normalise(items) {
    const list = (items || []).filter(Boolean);
    const safe = list.filter((it) => it === '-' || !it.danger);
    const danger = list.filter((it) => it !== '-' && it.danger);
    const all = danger.length ? safe.concat(['-'], danger) : safe;
    return all.filter((it, i) => it !== '-' || (i > 0 && all[i - 1] !== '-' && i < all.length - 1));
  }

  function hasItems(items) {
    return normalise(items).some((it) => it !== '-');
  }

  function attrsOf(attrs) {
    return Object.keys(attrs || {}).map((k) => ' ' + k + '="' + esc(attrs[k]) + '"').join('');
  }

  const SWATCH = /^#[0-9a-f]{6}$/i;

  function itemMarkup(it) {
    if (it === '-') return '<span class="menu-sep" role="separator"></span>';
    if (typeof it.checked === 'boolean') {
      return '<button type="button" class="menu-item menu-check-item" role="menuitemcheckbox" tabindex="-1"' +
        ' aria-checked="' + it.checked + '"' + attrsOf(it.attrs) + '>' +
        '<span class="menu-check" aria-hidden="true"></span>' +
        (SWATCH.test(it.swatch || '') ? '<span class="menu-swatch" aria-hidden="true" style="--swatch:' + it.swatch + '"></span>' : '') +
        '<span class="menu-text">' + esc(it.text) + '</span>' +
        (it.hint ? '<span class="menu-hint">' + esc(it.hint) + '</span>' : '') + '</button>';
    }
    const cls = 'menu-item' + (it.danger ? ' is-danger' : '');
    const inner = '<span class="menu-text">' + esc(it.text) + '</span>' +
      (it.hint ? '<span class="menu-hint">' + esc(it.hint) + '</span>' : '');
    if (it.href) {
      return '<a class="' + cls + '" role="menuitem" tabindex="-1" href="' + esc(it.href) + '"' +
        (it.download != null ? ' download="' + esc(it.download === true ? '' : it.download) + '"' : '') +
        attrsOf(it.attrs) + '>' + inner + '</a>';
    }
    return '<button type="button" class="' + cls + '" role="menuitem" tabindex="-1"' + attrsOf(it.attrs) + '>' + inner + '</button>';
  }

  function listMarkup(items) {
    return normalise(items).map(itemMarkup).join('');
  }

  /* The button and its list. `label` is the visible name ("Actions");
     `ariaLabel` replaces it for a ⋯ button or to add context ("Actions for
     the deposit invoice"). `btnClass` defaults to a quiet small button. */
  function markup(opts) {
    if (!hasItems(opts.items)) return '';
    const id = opts.id || 'menu-' + ++seq;
    const icon = opts.icon ? '<span aria-hidden="true">' + esc(opts.icon) + '</span>' : '';
    const text = opts.icon ? '' : esc(opts.label);
    return (
      '<span class="menu">' +
      '<button type="button" class="' + (opts.btnClass || 'btn btn-quiet btn-sm') + ' menu-btn' + (opts.icon ? ' menu-btn-icon' : '') + '" id="' + id + '-btn"' +
      ' aria-haspopup="menu" aria-expanded="false" aria-controls="' + id + '"' +
      (opts.ariaLabel || opts.icon ? ' aria-label="' + esc(opts.ariaLabel || opts.label) + '"' : '') + '>' +
      icon + text + (opts.icon ? '' : '<span class="menu-caret" aria-hidden="true"></span>') + '</button>' +
      '<span class="menu-list" role="menu" id="' + id + '" aria-labelledby="' + id + '-btn" hidden>' +
      listMarkup(opts.items) + '</span>' +
      '</span>'
    );
  }

  // ── Open and close ──
  const ITEM = '[role="menuitem"], [role="menuitemcheckbox"]';

  function itemsOf(list) {
    return Array.from(list.querySelectorAll(ITEM));
  }

  function labelOf(item) {
    const t = item.querySelector('.menu-text');
    return (t ? t.textContent : item.textContent).trim().toLowerCase();
  }

  function focusItem(list, n) {
    const items = itemsOf(list);
    if (!items.length) return;
    items[(n + items.length) % items.length].focus();
  }

  /* Under the button, left edges aligned; right-aligned when there's no room
     to the right; above it when there's no room below and there is above.
     Document coordinates, so it scrolls with the page as the button does. */
  function place(list, opener) {
    const r = opener.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const w = list.offsetWidth;
    const h = list.offsetHeight;
    const gap = 4;
    let left = r.left;
    if (left + w > vw - 8) left = r.right - w;
    left = Math.max(8, Math.min(left, vw - w - 8));
    const below = r.bottom + gap + h <= window.innerHeight - 8 || r.top - gap - h < 8;
    list.style.left = Math.round(left + window.scrollX) + 'px';
    list.style.top = Math.round((below ? r.bottom + gap : r.top - gap - h) + window.scrollY) + 'px';
    list.classList.toggle('is-above', !below);
  }

  function show(opener, list, opts) {
    close(false);
    const sheet = PHONE.matches;
    const home = opts.home ? { parent: list.parentNode, next: list.nextSibling } : null;
    cur = { opener, list, home, sheet, onSelect: opts.onSelect || null, backdrop: null, cancel: null, inerted: null };

    list.classList.add('menu-pop');
    list.classList.toggle('is-sheet', sheet);
    if (sheet) {
      const backdrop = document.createElement('div');
      backdrop.className = 'menu-backdrop';
      backdrop.addEventListener('click', () => close(true));
      document.body.appendChild(backdrop);
      cur.backdrop = backdrop;
      // The sheet names what it's for, and ends with Cancel.
      const title = opts.title || list.getAttribute('aria-label') || opener.getAttribute('aria-label') || opener.textContent;
      list.insertAdjacentHTML('afterbegin', '<span class="menu-sheet-title" aria-hidden="true">' + esc(title.trim()) + '</span>');
      // A checkbox's choice is made as it's ticked, so there's nothing to cancel.
      const done = list.querySelector('[role="menuitemcheckbox"]');
      list.insertAdjacentHTML('beforeend',
        '<button type="button" class="menu-item menu-cancel" role="menuitem" tabindex="-1" data-menu-cancel>' +
        '<span class="menu-text">' + (done ? 'Done' : 'Cancel') + '</span></button>');
      /* The page behind the backdrop is out of reach to a screen reader's
         swipe too, as Tab already is (task 14). The sheet lives in <body>,
         outside #app-view. */
      const app = document.getElementById('app-view');
      if (app && !app.inert) {
        app.inert = true;
        cur.inerted = app;
      }
    }
    document.body.appendChild(list);
    list.hidden = false;
    if (!sheet) place(list, opener);
    opener.setAttribute('aria-expanded', 'true');

    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('hashchange', onHash);
    PHONE.addEventListener('change', onModeChange);
    if (!sheet) window.addEventListener('resize', onResize);
    typed = '';

    if (itemsOf(list).length && !list.querySelector('.menu-note')) {
      focusItem(list, opts.last ? -1 : 0);
    } else {
      list.setAttribute('tabindex', '-1');
      list.focus();
    }
  }

  /* Closes the open menu. returnFocus puts focus back on its button (Esc,
     Cancel, the backdrop, a choice); an outside click leaves focus where the
     click put it. */
  function close(returnFocus) {
    if (!cur) return;
    const { opener, list, home, backdrop, inerted } = cur;
    cur = null;
    if (inerted) inerted.inert = false;
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('hashchange', onHash);
    PHONE.removeEventListener('change', onModeChange);
    window.removeEventListener('resize', onResize);
    if (backdrop) backdrop.remove();
    list.querySelectorAll('.menu-sheet-title, [data-menu-cancel]').forEach((el) => el.remove());
    list.classList.remove('menu-pop', 'is-sheet', 'is-above');
    list.removeAttribute('style');
    list.hidden = true;
    if (home && home.parent && home.parent.isConnected) home.parent.insertBefore(list, home.next && home.next.parentNode === home.parent ? home.next : null);
    else list.remove();
    opener.setAttribute('aria-expanded', 'false');
    if (returnFocus && opener.isConnected) opener.focus();
  }

  function onOutside(e) {
    if (!cur || cur.sheet) return; // the sheet's backdrop takes every outside press
    if (!cur.list.contains(e.target) && !cur.opener.contains(e.target)) close(false);
  }
  function onHash() {
    close(false);
  }
  /* Crossing 768px (a phone turned sideways) closes it, since a sheet isn't
     a popover. Only a settled change counts: a capture or a pane re-layout
     can flip the width for a frame and back. */
  let modeTimer = null;
  function onModeChange() {
    clearTimeout(modeTimer);
    modeTimer = setTimeout(() => {
      if (cur && PHONE.matches !== cur.sheet) close(true);
    }, 150);
  }
  function onResize() {
    if (cur && !cur.sheet) {
      if (!cur.opener.isConnected) close(false);
      else place(cur.list, cur.opener);
    }
  }

  /* A choice. A declarative item goes home first and is clicked there, so
     the screen's delegated handler sees it in place. */
  function choose(item) {
    if (!cur) return;
    if (item.hasAttribute('data-menu-cancel')) {
      close(true);
      return;
    }
    if (item.getAttribute('role') === 'menuitemcheckbox') {
      const checked = item.getAttribute('aria-checked') !== 'true';
      item.setAttribute('aria-checked', String(checked));
      if (cur.onSelect) cur.onSelect(item, checked);
      return;
    }
    const { home, onSelect } = cur;
    close(true);
    if (onSelect) onSelect(item);
    else if (home) item.click();
  }

  // ── Keys and clicks inside an open list ──
  document.addEventListener('keydown', (e) => {
    if (!cur || !cur.list.contains(e.target)) return;
    const { list, sheet } = cur;
    const items = itemsOf(list);
    const i = items.indexOf(document.activeElement);
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        focusItem(list, i < 0 ? (e.key === 'ArrowDown' ? 0 : -1) : i + (e.key === 'ArrowDown' ? 1 : -1));
        return;
      case 'Home':
      case 'End':
        e.preventDefault();
        focusItem(list, e.key === 'Home' ? 0 : -1);
        return;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation(); // a menu inside a dialog closes alone
        close(true);
        return;
      case 'Enter':
      case ' ':
        if (i >= 0) {
          e.preventDefault();
          choose(items[i]);
        }
        return;
      case 'Tab':
        if (sheet) {
          // The modal trap: Tab walks the sheet's rows and wraps.
          e.preventDefault();
          focusItem(list, i + (e.shiftKey ? -1 : 1));
        } else {
          // APG: Tab closes the menu and carries on from its button.
          close(true);
        }
        return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && items.length) {
          const now = Date.now();
          typed = (now - typedAt > TYPEAHEAD_MS ? '' : typed) + e.key.toLowerCase();
          typedAt = now;
          // The next item from here that starts with what's been typed; a
          // repeated letter steps through the items starting with it.
          const q = /^(.)\1*$/.test(typed) ? typed[0] : typed;
          const from = q.length === 1 ? i + 1 : Math.max(i, 0);
          for (let k = 0; k < items.length; k++) {
            const it = items[(from + k) % items.length];
            if (labelOf(it).startsWith(q)) {
              it.focus();
              break;
            }
          }
        }
    }
  }, true);

  document.addEventListener('click', (e) => {
    if (cur && cur.list.contains(e.target)) {
      const item = e.target.closest(ITEM);
      // The real click happens at home (choose); this one stops here.
      e.preventDefault();
      e.stopPropagation();
      if (item) choose(item);
      return;
    }
    const btn = e.target.closest('.menu-btn');
    if (!btn) return;
    if (cur && cur.opener === btn) {
      close(true);
      return;
    }
    const list = document.getElementById(btn.getAttribute('aria-controls'));
    if (list) show(btn, list, { home: true });
  }, true);

  // Mouse hover moves focus, so the pointer and the keys never light two rows.
  document.addEventListener('pointerover', (e) => {
    if (!cur || e.pointerType !== 'mouse') return;
    const item = e.target.closest(ITEM);
    if (item && cur.list.contains(item) && document.activeElement !== item) item.focus({ preventScroll: true });
  });

  // ArrowDown / ArrowUp on a closed menu button open it at the first / last item.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const btn = e.target.closest && e.target.closest('.menu-btn');
    if (!btn || (cur && cur.opener === btn)) return;
    const list = document.getElementById(btn.getAttribute('aria-controls'));
    if (!list) return;
    e.preventDefault();
    show(btn, list, { home: true, last: e.key === 'ArrowUp' });
  });

  /* A menu built on the spot. The same opener again closes it. With no
     items it shows `empty` (if given) as a note instead. */
  function open(opener, opts) {
    if (cur && cur.opener === opener) {
      close(true);
      return;
    }
    const list = document.createElement('div');
    list.className = 'menu-list';
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-label', opts.label);
    list.hidden = true;
    list.innerHTML = hasItems(opts.items)
      ? listMarkup(opts.items)
      : '<p class="menu-note">' + esc(opts.empty || 'Nothing to choose.') + '</p>';
    const items = normalise(opts.items).filter((it) => it !== '-');
    itemsOf(list).forEach((el, n) => (el._menuItem = items[n]));
    show(opener, list, {
      title: opts.title,
      last: opts.last,
      onSelect: opts.onSelect ? (el, checked) => opts.onSelect(el._menuItem, checked) : null,
    });
  }

  function isOpen(opener) {
    return !!cur && (!opener || cur.opener === opener);
  }

  return { markup, open, close, isOpen, hasItems };
})();
