'use strict';

/* Client typeahead: turns a text input into a combobox over GET /api/clients?q=.
 *
 * It only reads. What a pick does to the form is the caller's business
 * (onPick); the input stays an ordinary free-text field, so a business that
 * isn't in the client list can still be typed.
 *
 * A search that fails just closes the list. It is a convenience riding on a
 * form that works without it, and api.js already reports the failure to the
 * connection banner — a second message here would only repeat it.
 *
 * Replies can arrive out of order on a slow link, so each search carries a
 * sequence number and anything but the latest is dropped. Otherwise typing
 * "acme" could end up showing the results for "a".
 */

const ClientTypeahead = (() => {
  const { esc } = LSCUtil;
  const DEBOUNCE_MS = 200;
  let instances = 0;

  function attach(input, options) {
    const onPick = options.onPick;
    const listId = 'typeahead-list-' + ++instances;

    const list = document.createElement('ul');
    list.className = 'typeahead-list';
    list.id = listId;
    list.setAttribute('role', 'listbox');
    list.hidden = true;

    // The list hangs off the input, so the two share a positioned wrapper.
    const wrap = document.createElement('div');
    wrap.className = 'typeahead-wrap';
    input.insertAdjacentElement('beforebegin', wrap);
    wrap.appendChild(input);
    wrap.appendChild(list);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('autocomplete', 'off');

    let results = [];
    let active = -1;
    let timer = null;
    let seq = 0;

    function close() {
      list.hidden = true;
      list.innerHTML = '';
      results = [];
      active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function setActive(index) {
      active = index;
      Array.from(list.children).forEach((li, i) => {
        li.setAttribute('aria-selected', i === index ? 'true' : 'false');
      });
      if (index >= 0) {
        input.setAttribute('aria-activedescendant', listId + '-' + index);
        list.children[index].scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function render(clients) {
      results = clients;
      active = -1;
      if (!clients.length) return close();
      list.innerHTML = clients
        .map((client, i) => {
          const sub = [client.contactName, client.email].filter(Boolean).join(' · ');
          return (
            '<li role="option" id="' + listId + '-' + i + '" aria-selected="false" data-i="' + i + '">' +
            '<span class="ta-name">' + esc(client.businessName) + '</span>' +
            (sub ? '<span class="ta-sub">' + esc(sub) + '</span>' : '') +
            '</li>'
          );
        })
        .join('');
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    async function search(query) {
      const mine = ++seq;
      let reply;
      try {
        reply = await LSCApi.get('/api/clients?q=' + encodeURIComponent(query));
      } catch (err) {
        if (mine === seq) close();
        return;
      }
      // Stale reply, or the field was cleared/blurred while it was in flight.
      if (mine !== seq || document.activeElement !== input) return;
      render(reply.clients || []);
    }

    function pick(index) {
      const client = results[index];
      if (!client) return;
      seq++; // a search still in flight must not reopen the list over the pick
      clearTimeout(timer);
      close();
      onPick(client);
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const query = input.value.trim();
      if (!query) {
        seq++;
        return close();
      }
      timer = setTimeout(() => search(query), DEBOUNCE_MS);
    });

    input.addEventListener('keydown', (event) => {
      if (list.hidden) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive(active < results.length - 1 ? active + 1 : 0);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive(active > 0 ? active - 1 : results.length - 1);
      } else if (event.key === 'Enter' && active >= 0) {
        event.preventDefault();
        pick(active);
      } else if (event.key === 'Escape') {
        // Stops here so an enclosing handler (a modal's Escape) doesn't also fire.
        event.stopPropagation();
        close();
      }
    });

    input.addEventListener('blur', () => {
      clearTimeout(timer);
      seq++;
      close();
    });

    // mousedown, not click: click fires after the input's blur has already
    // closed the list. preventDefault keeps focus in the field.
    list.addEventListener('mousedown', (event) => {
      const li = event.target.closest('li[data-i]');
      if (!li) return;
      event.preventDefault();
      pick(Number(li.dataset.i));
    });
  }

  return { attach };
})();
