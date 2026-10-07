'use strict';

/* A list reordered by its handles (ui-clarity task 5): the agreement's clause
 * cards, and task 6's sub-clause rows inside them. Its CSS is the
 * .sort-* rules in settings.css.
 *
 *   LSCSortable.attach(list, { item, handle, onMove(from, to) })
 *
 * `item` and `handle` are selectors. Only items that are direct children of
 * `list` take part, so a sortable list nested inside one of its items (the
 * sub-clauses inside an open card) is left to its own attach().
 *
 * TWO WAYS TO MOVE, ONE ANSWER
 *   Pointer drag on a handle, mouse or touch (the handle is touch-action:
 *   none, so a finger on it drags rather than scrolls). The item lifts and
 *   follows the pointer, a line in --color-accent-mark shows where it will
 *   land, and the page scrolls when the pointer nears the top or bottom.
 *   Esc or a cancelled pointer puts it back.
 *
 *   Alt+↑ / Alt+↓ on a focused handle (WCAG 2.5.7's non-drag way; the
 *   screen's ⋯ menu is the other).
 *
 * Neither touches the DOM's order: both call onMove(from, to) with indexes
 * into the items as they stand, `to` being where the item ends up. The
 * screen moves its data and its node together, so there is one code path for
 * every move, menus included. */

const LSCSortable = (() => {
  const START_PX = 5; // a press that wanders less than this is still a press
  const EDGE_PX = 72; // nearer the window's top or bottom than this scrolls it
  const MAX_SCROLL = 14; // px per frame at the very edge

  function attach(list, opts) {
    const items = () => Array.from(list.children).filter((el) => el.matches(opts.item));
    const ownHandle = (target) => {
      const handle = target.closest && target.closest(opts.handle);
      const item = handle && handle.closest(opts.item);
      return item && item.parentElement === list ? { handle, item } : null;
    };

    let drag = null;

    function lineAt(k, others) {
      const box = list.getBoundingClientRect();
      let y;
      if (!others.length) y = 0;
      else if (k === 0) y = others[0].getBoundingClientRect().top - 3;
      else if (k >= others.length) y = others[others.length - 1].getBoundingClientRect().bottom + 3;
      else y = (others[k - 1].getBoundingClientRect().bottom + others[k].getBoundingClientRect().top) / 2;
      return y - box.top;
    }

    /* Where the dragged item would land: before the first other item whose
       middle is below the pointer. */
    function place() {
      const { item, others, pointerY } = drag;
      const dy = pointerY + window.scrollY - drag.startPageY;
      item.style.transform = 'translateY(' + Math.round(dy) + 'px)';
      let k = 0;
      others.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (pointerY > r.top + r.height / 2) k += 1;
      });
      drag.to = k;
      drag.line.style.top = Math.round(lineAt(k, others) - 1) + 'px';
    }

    function tick() {
      if (!drag || !drag.on) return;
      const y = drag.pointerY;
      const h = window.innerHeight;
      let step = 0;
      if (y < EDGE_PX) step = -Math.ceil(MAX_SCROLL * (1 - y / EDGE_PX));
      else if (y > h - EDGE_PX) step = Math.ceil(MAX_SCROLL * (1 - (h - y) / EDGE_PX));
      if (step) {
        window.scrollBy(0, step);
        place();
      }
      drag.frame = requestAnimationFrame(tick);
    }

    function begin() {
      drag.on = true;
      if (window.LSCMenu) LSCMenu.close(false);
      drag.others = items().filter((el) => el !== drag.item);
      drag.line = document.createElement('div');
      drag.line.className = 'sort-line';
      drag.line.setAttribute('aria-hidden', 'true');
      list.classList.add('sort-active');
      list.appendChild(drag.line);
      drag.item.classList.add('is-dragging');
      document.documentElement.classList.add('sort-dragging');
      document.addEventListener('keydown', onKey, true);
      place();
      drag.frame = requestAnimationFrame(tick);
    }

    function end(commit) {
      if (!drag) return;
      const d = drag;
      drag = null;
      cancelAnimationFrame(d.frame);
      document.removeEventListener('keydown', onKey, true);
      if (!d.on) return;
      d.item.classList.remove('is-dragging');
      d.item.style.transform = '';
      d.line.remove();
      list.classList.remove('sort-active');
      document.documentElement.classList.remove('sort-dragging');
      if (commit && d.to !== d.from) opts.onMove(d.from, d.to);
      else d.handle.focus({ preventScroll: true });
    }

    function onKey(e) {
      if (e.key !== 'Escape' || !drag) return;
      e.preventDefault();
      e.stopPropagation();
      end(false);
    }

    list.addEventListener('pointerdown', (e) => {
      const hit = ownHandle(e.target);
      if (!hit || e.button !== 0 || drag) return;
      const all = items();
      if (all.length < 2) return;
      e.preventDefault(); // no text selection, and the handle keeps focus
      hit.handle.focus({ preventScroll: true });
      drag = {
        item: hit.item,
        handle: hit.handle,
        from: all.indexOf(hit.item),
        to: all.indexOf(hit.item),
        x: e.clientX,
        pointerY: e.clientY,
        startPageY: e.clientY + window.scrollY,
        on: false,
        frame: 0,
      };
      try {
        hit.handle.setPointerCapture(e.pointerId); // the moves keep coming once the pointer leaves the handle
      } catch (_) {
        /* a pointer the browser no longer tracks: it still works over the handle */
      }
    });

    list.addEventListener('pointermove', (e) => {
      if (!drag) return;
      drag.pointerY = e.clientY;
      if (!drag.on) {
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY + window.scrollY - drag.startPageY) < START_PX) return;
        begin();
      }
      place();
    });

    list.addEventListener('pointerup', () => end(true));
    list.addEventListener('pointercancel', () => end(false));
    list.addEventListener('lostpointercapture', () => {
      if (drag && drag.on) end(true);
      else drag = null;
    });

    list.addEventListener('keydown', (e) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const hit = ownHandle(e.target);
      if (!hit) return;
      e.preventDefault();
      const all = items();
      const from = all.indexOf(hit.item);
      const to = from + (e.key === 'ArrowUp' ? -1 : 1);
      if (to >= 0 && to < all.length) opts.onMove(from, to);
    });

    return { cancel: () => end(false) };
  }

  return { attach };
})();
