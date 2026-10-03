'use strict';

/* #/projects — the Projects list (production-booking task 17; D58, IA
 * "Projects"). One card per project, newest activity first, from
 * GET /api/projects. It replaces the estimates list, whose first-run
 * checklist and UPID fix-up banner it keeps.
 *
 * THE FILTER IS IN THE ADDRESS: `?stage=` (a chip; Active when absent) and
 * `?q=` (the search). A chip is a step in history, so Back returns to the last
 * one; typing replaces the entry instead of adding one per keystroke. When
 * only the query changes, the router calls show() again with this screen
 * still up, and it is updated in place: the search box keeps its focus and
 * what's half-typed in it, and only the cards are redrawn.
 *
 * 50 at a time (IA, Content Growth Plan); "Show more" fetches the next 50
 * from where the last page stopped. More pages aren't in the address: a reload
 * starts from the top again.
 */

const ProjectsView = (() => {
  const { esc } = LSCUtil;

  const LIST = '/projects';
  const SEARCH_WAIT_MS = 300;
  const STAGE_KEYS = ProjectCard.CHIPS.map(([key]) => key);

  let root = null;
  let handlers = null;

  // What the screen on #main is showing, while it's this one.
  let filter = { stage: 'active', q: '' };
  let projects = [];
  let next = null;
  let typing = null; // the search box's pending route change
  let firstLoad = true; // nothing to announce on arrival: the heading says it

  const onScreen = () => Boolean(root && root.querySelector('#projects-view'));
  const $ = (id) => root.querySelector('#' + id);

  /* '/projects?stage=sent&q=acme', leaving out what is the default. */
  function pathFor(f) {
    const params = new URLSearchParams();
    if (f.stage !== 'active') params.set('stage', f.stage);
    if (f.q) params.set('q', f.q);
    const qs = params.toString();
    return qs ? LIST + '?' + qs : LIST;
  }

  // ── First run ────────────────────────────────────────────────────────────

  /* What a fresh account still has to set up, shown only while there are no
     projects at all. Read from LSCData's updatedAt flags rather than the
     contents: the rate card answers with the built-in defaults whether or not
     anyone has saved it, so the question is "has it ever been written". */
  function setupSteps() {
    const steps = [];
    if (!LSCData.pricingConfigured()) {
      steps.push({
        id: 'pricing',
        title: 'Check your rate card',
        body:
          'Every estimate is priced from it. What’s in there now is the built-in default ' +
          'card — open it, change anything that’s out of date, and save once to make it yours.',
        action: 'Open Pricing',
      });
    }
    if (!LSCData.settingsConfigured()) {
      steps.push({
        id: 'settings',
        title: 'Add your invoice details',
        body:
          'Your business name, ABN and bank details. Until they’re saved an invoice prints ' +
          'no payment block at all, and one that charges GST won’t export without an ABN.',
        action: 'Open Invoice Settings',
      });
    }
    return steps;
  }

  function stepMarkup(step) {
    return (
      '<li class="first-run-step">' +
      '<div class="first-run-step-text"><div class="first-run-step-title">' +
      esc(step.title) + '</div><p>' + esc(step.body) + '</p></div>' +
      // Navigation, not a write, so no data-write: the connection banner has
      // no reason to block opening a screen.
      '<button class="btn btn-sm" data-setup="' + esc(step.id) + '">' + esc(step.action) + '</button>' +
      '</li>'
    );
  }

  function firstRunMarkup() {
    const steps = setupSteps();
    if (!steps.length) {
      return (
        '<div class="empty-state"><h3>No projects yet</h3>' +
        '<p>Click <strong>New project</strong> to start one. Its estimate is the first thing you’ll write.</p></div>'
      );
    }
    return (
      '<div class="empty-state first-run"><h3>No projects yet</h3>' +
      '<p>' +
      (steps.length === 1
        ? 'One thing is worth setting up before your first invoice.'
        : 'Two things are worth setting up before your first invoice.') +
      '</p><ol class="first-run-steps">' + steps.map(stepMarkup).join('') + '</ol>' +
      '<p class="first-run-skip">You can start a project now and come back to these — ' +
      'they only change what a new estimate is priced and printed from.</p></div>'
    );
  }

  function bindSetup(container) {
    container.querySelectorAll('[data-setup]').forEach((btn) => {
      btn.addEventListener('click', () => {
        // The button goes to onOpenSettings so the modal can hand focus back.
        if (btn.dataset.setup === 'pricing') handlers.onGoPricing();
        else handlers.onOpenSettings(btn);
      });
    });
  }

  // ── The shell: head, banner, search and chips ────────────────────────────

  function chipsMarkup() {
    return ProjectCard.CHIPS.map(([key, word]) =>
      '<button type="button" class="stage-chip" data-stage="' + key + '" aria-pressed="' + (key === filter.stage) + '">' +
      '<span class="stage-chip-word">' + word + '</span><span class="stage-chip-count" data-count="' + key + '"></span>' +
      '</button>'
    ).join('');
  }

  function shellMarkup() {
    return (
      '<div id="projects-view">' +
      '<div class="page-head"><div><h1 class="page-title">Projects</h1>' +
      '<div class="page-sub" id="projects-sub">Loading…</div></div>' +
      '<button class="btn btn-accent" id="js-new">+ New project</button></div>' +
      '<div id="projects-banner"></div>' +
      '<div class="projects-tools">' +
      '<div class="projects-search" role="search">' +
      '<label class="sr-only" for="projects-q">Search projects</label>' +
      '<input type="search" id="projects-q" class="projects-q" autocomplete="off" spellcheck="false" ' +
      'placeholder="Search UPID, project or client" value="' + esc(filter.q) + '">' +
      '</div>' +
      '<div class="stage-chips" role="group" aria-label="Show projects by stage">' + chipsMarkup() + '</div>' +
      '</div>' +
      '<div id="projects-results" aria-busy="true"></div>' +
      '<p class="sr-only" id="projects-live" aria-live="polite"></p>' +
      '</div>'
    );
  }

  function mountShell() {
    root.innerHTML = shellMarkup();
    $('js-new').addEventListener('click', () => handlers.onNew());

    const input = $('projects-q');
    const search = () => {
      clearTimeout(typing);
      typing = null;
      if (!onScreen()) return;
      const q = input.value.trim();
      if (q === filter.q) return;
      LSCRouter.go(pathFor({ stage: filter.stage, q }), { replace: true });
    };
    input.addEventListener('input', () => {
      clearTimeout(typing);
      typing = setTimeout(search, SEARCH_WAIT_MS);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') search();
    });

    root.querySelectorAll('.stage-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        if (chip.dataset.stage === filter.stage) return;
        // Whatever is typed counts, even if the wait hasn't run out.
        clearTimeout(typing);
        typing = null;
        LSCRouter.go(pathFor({ stage: chip.dataset.stage, q: input.value.trim() }));
      });
    });
  }

  /* On a phone the chips are a row that scrolls sideways (projects.css): the
     chosen one is brought into it, clear of the row's 16px inset, without
     moving the page. Run once the counts are in, which widen every chip. */
  const CHIP_INSET = 16;
  function revealChosenChip() {
    const row = root.querySelector('.stage-chips');
    const chip = row && row.querySelector('[aria-pressed="true"]');
    if (!chip || row.scrollWidth <= row.clientWidth) return;
    const start = chip.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
    const end = start + chip.getBoundingClientRect().width;
    if (start < row.scrollLeft + CHIP_INSET) row.scrollLeft = start - CHIP_INSET;
    else if (end > row.scrollLeft + row.clientWidth - CHIP_INSET) row.scrollLeft = end - row.clientWidth + CHIP_INSET;
  }

  /* The address moved under a mounted list (a chip, the search, Back). */
  function syncShell() {
    root.querySelectorAll('.stage-chip').forEach((chip) => {
      chip.setAttribute('aria-pressed', String(chip.dataset.stage === filter.stage));
    });
    revealChosenChip();
    // Not while it reads the same: "acme " is still the search for "acme",
    // and rewriting it would eat the space being typed.
    const input = $('projects-q');
    if (input.value.trim() !== filter.q) input.value = filter.q;
  }

  function bannerMarkup(needsUpid) {
    if (!needsUpid) return '';
    return (
      '<div class="upid-banner" role="note"><p><strong>' +
      needsUpid + (needsUpid === 1 ? ' project needs' : ' projects need') + ' a UPID</strong> ' +
      'before invoicing can be used. Some estimates share one, or have none.</p>' +
      '<button type="button" class="btn btn-sm" id="js-fix-upids">Fix now</button></div>'
    );
  }

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

  /* Under a search, `counts.all` is every match in any stage; without one,
     every project. */
  function subText(reply) {
    const all = reply.counts.all;
    if (filter.q) {
      return reply.total === all ? plural(all, 'match', 'matches') : reply.total + ' of ' + plural(all, 'match', 'matches');
    }
    if (reply.total === all) return all ? plural(all, 'project') : 'No projects yet';
    return reply.total + ' of ' + plural(all, 'project');
  }

  // ── The results ──────────────────────────────────────────────────────────

  function chipWord(stage) {
    const chip = ProjectCard.CHIPS.find(([key]) => key === stage);
    return chip ? chip[1].toLowerCase() : '';
  }

  function emptyMarkup(reply) {
    if (!reply.counts.all && !filter.q) return firstRunMarkup();
    if (filter.q) {
      return (
        '<div class="empty-state"><h3>Nothing matches “' + esc(filter.q) + '”</h3>' +
        '<p>' + (filter.stage === 'active' ? 'Search looks at every project’s UPID, name and client.'
          : 'That’s among ' + esc(chipWord(filter.stage)) + ' projects only. Active searches every stage.') + '</p>' +
        '<button type="button" class="btn" id="js-clear" style="margin-top:16px">Clear search</button></div>'
      );
    }
    if (filter.stage === 'active') {
      return (
        '<div class="empty-state"><h3>Nothing active</h3>' +
        '<p>Every project was paid or declined more than 90 days ago. They’re under Paid and Declined.</p></div>'
      );
    }
    return '<div class="empty-state"><h3>No ' + esc(chipWord(filter.stage)) + ' projects</h3></div>';
  }

  function moreMarkup() {
    if (!next) return '';
    return (
      '<div class="projects-more"><button type="button" class="btn" id="js-more">' +
      '<span class="spinner" id="more-spin"></span><span id="more-label">Show more</span></button></div>'
    );
  }

  function drawResults(reply) {
    const box = $('projects-results');
    const today = LSCUtil.today();
    box.innerHTML = projects.length
      ? '<div class="cards-grid" role="list" id="projects-grid">' +
        projects.map((p) => ProjectCard.cardMarkup(p, today)).join('') + '</div>' + moreMarkup()
      : emptyMarkup(reply);
    ProjectCard.bind(box, projects, handlers.onOpen);
    bindSetup(box);
    const clear = box.querySelector('#js-clear');
    if (clear) {
      clear.addEventListener('click', () => {
        LSCRouter.go(pathFor({ stage: filter.stage, q: '' }));
        $('projects-q').focus();
      });
    }
    bindMore();
  }

  function bindMore() {
    const more = $('js-more');
    if (more) more.addEventListener('click', showMore);
  }

  function drawFrame(reply) {
    $('projects-sub').textContent = subText(reply);
    $('projects-banner').innerHTML = bannerMarkup(reply.needsUpid || 0);
    const fix = $('js-fix-upids');
    if (fix) fix.addEventListener('click', () => handlers.onFixUpids());
    root.querySelectorAll('[data-count]').forEach((el) => {
      const n = reply.counts[el.dataset.count];
      el.textContent = n === undefined ? '' : String(n);
    });
    revealChosenChip();
  }

  function query(extra) {
    const params = new URLSearchParams({ today: LSCUtil.today(), stage: filter.stage });
    if (filter.q) params.set('q', filter.q);
    Object.entries(extra || {}).forEach(([k, v]) => params.set(k, v));
    return '/api/projects?' + params.toString();
  }

  function failureText(err) {
    return err.kind === 'network' ? 'The server could not be reached.' : err.message || 'The server had a problem.';
  }

  async function load() {
    const ticket = LSCRouter.ticket();
    const box = $('projects-results');
    box.setAttribute('aria-busy', 'true');
    let reply;
    try {
      reply = await LSCApi.get(query());
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (!LSCRouter.isCurrent(ticket)) return;
      if (err.kind === 'auth') return handlers.onAuthLost();
      // 'network' and 'server' raise the connection banner too; the list
      // still says something where its cards would be.
      $('projects-sub').textContent = 'Could not load';
      box.removeAttribute('aria-busy');
      box.innerHTML =
        '<div class="empty-state"><h3>Couldn’t load your projects</h3><p>' + esc(failureText(err)) + '</p>' +
        '<button type="button" class="btn" id="js-retry" style="margin-top:16px">Try Again</button></div>';
      $('js-retry').addEventListener('click', load);
      return;
    }
    // A later filter, or another screen, has been asked for since.
    if (!LSCRouter.isCurrent(ticket) || !onScreen()) return;
    projects = reply.projects || [];
    next = reply.next || null;
    drawFrame(reply);
    drawResults(reply);
    box.removeAttribute('aria-busy');
    if (!firstLoad) {
      LSCUtil.announce($('projects-live'), reply.total ? plural(reply.total, 'project') + ' shown' : 'No projects shown');
    }
    firstLoad = false;
  }

  /* The next page, added under the cards already there. Focus moves to the
     first new card, so a keyboard user carries on from where the list grew. */
  async function showMore() {
    const btn = $('js-more');
    if (!btn || btn.disabled || !next) return;
    const ticket = LSCRouter.ticket();
    btn.disabled = true;
    $('more-spin').style.display = 'inline-block';
    $('more-label').textContent = 'Loading…';
    let reply;
    try {
      reply = await LSCApi.get(query({ before: next }));
    } catch (err) {
      if (!(err instanceof LSCApi.ApiError)) throw err;
      if (!LSCRouter.isCurrent(ticket) || !onScreen()) return;
      if (err.kind === 'auth') return handlers.onAuthLost();
      btn.disabled = false;
      $('more-spin').style.display = 'none';
      $('more-label').textContent = 'Show more';
      Toast.error('Couldn’t load more projects: ' + failureText(err));
      return;
    }
    if (!LSCRouter.isCurrent(ticket) || !onScreen()) return;
    const added = (reply.projects || []).filter((p) => !projects.some((q) => q.id === p.id));
    projects = projects.concat(added);
    next = reply.next || null;
    const today = LSCUtil.today();
    const grid = $('projects-grid');
    const holder = document.createElement('div');
    holder.innerHTML = added.map((p) => ProjectCard.cardMarkup(p, today)).join('');
    ProjectCard.bind(holder, added, handlers.onOpen);
    const fresh = Array.from(holder.children);
    fresh.forEach((card) => grid.appendChild(card));
    const wrap = root.querySelector('.projects-more');
    if (wrap) wrap.remove();
    grid.insertAdjacentHTML('afterend', moreMarkup());
    bindMore();
    if (fresh[0]) fresh[0].querySelector('.card-open').focus();
  }

  /* Settings opens over this screen without unmounting it, so a save there
     would leave the checklist listing the step it had just satisfied. A no-op
     unless the checklist is on screen. The Pricing step needs none: opening
     Pricing replaces this screen, and coming back re-mounts it. */
  function refreshFirstRun() {
    if (!onScreen()) return;
    const block = root.querySelector('.empty-state.first-run');
    if (!block) return;
    const holder = document.createElement('div');
    holder.innerHTML = firstRunMarkup();
    block.replaceWith(holder.firstElementChild);
    bindSetup($('projects-results'));
  }

  return {
    /* Once per sign-in: where to draw, and the routes out that app.js owns. */
    init(container, options) {
      root = container;
      handlers = options;
    },

    /* The router's way in: the route (LSCRouter.parse), whose segments after
       'projects' must be none. False for a shape this area doesn't have. */
    show(route) {
      if (route.segments.length > 1) return false;
      const stage = route.query.get('stage') || 'active';
      const wanted = {
        stage: STAGE_KEYS.includes(stage) ? stage : 'active',
        q: (route.query.get('q') || '').trim(),
      };
      // An address this list wouldn't write (an unknown stage, a padded
      // search, a stray parameter) is put right rather than half-understood.
      const canonical = pathFor(wanted);
      if (canonical !== route.key) {
        LSCRouter.go(canonical, { replace: true, skipGuard: true });
        return true;
      }
      clearTimeout(typing);
      typing = null;
      filter = wanted;
      if (onScreen()) {
        syncShell();
      } else {
        window.scrollTo(0, 0);
        firstLoad = true;
        projects = [];
        next = null;
        mountShell();
      }
      load();
      return true;
    },

    refreshFirstRun,
  };
})();
