# Decisions: UI Clarity

The user's answers from Grill Me (2026-10-06). Don't re-ask. Numbered U1… so they don't clash with
production-booking's D1–D104. The user's request had three parts: **D1** (the UI is too busy),
**D2** (email branding) and **D3** (the service agreement builder).

## D1: the UI is too busy

- **U1. Scope.** Fix the shared system first (tokens, panels, button hierarchy, menus), so every
  screen improves a little. Then fully rework three screens: the **Project page**, the **Estimate
  editor** and the **Invoice screen**. Other screens (Finance & Price, Rate Card, Clients, Home,
  Settings) only get the system-level change in this track.
- **U2. Separation means layered panels.** There are three surface levels: page, then panel, then
  inset. Each section is a panel with a header bar and padding. Rows inside a panel are separated
  by hairlines only, and fewer things get borders.
- **U3. Document actions.** Each estimate or invoice row has one primary button (Open, or Send
  when it's a draft), an **Actions ▾** menu (Edit, Send, Copy link, Duplicate, Decline, Void…)
  and a **Documents ▾** menu (its PDFs, the Cost Breakdown). The project header has one primary
  button and its own Actions ▾ (Decline, Duplicate as new project, Delete).
- **U4. Capitals** are used only for nav, eyebrow labels (UPID, TOTAL) and the single primary
  button. Every other button and menu item is sentence case.
- **U5. The Estimate editor** becomes collapsible section panels, with a jump rail beside them
  and a sticky bottom bar showing the client total, Cancel and Save. It stays one page: no tabs
  or steps.
- **U6. The app stays dark.** The layers are reworked inside the dark theme. The client pages stay
  light.

## D2: email branding

- **U7. Logo.** The user will provide a logo file. It's hosted as a PNG with the app (Pages) and
  referenced by URL, because Gmail and Outlook block embedded and SVG images.
- **U8. The look is light, in the site's colours.** Paper background; logo plus "LSC Creative"
  header; a white card holding the heading, project and message; a terracotta button; a footer
  with the business name, ABN and contact. It applies to every email (quote, invoice, update,
  signed copy, owner notices, test).

## D3: the service agreement builder

- **U9. Settings master only.** The builder replaces the text box in Settings → Service agreement.
  There are no per-project edits.
- **U10. Header.** A fixed layout, filled from the project's fields: Parties, Project, Payment
  schedule, Scope and production days. It sits above the modules and is shown with its fields
  marked. The Deposit and Balance rows hide on a single-invoice project.
- **U11. Smart features: auto-lettered sub-clauses only.** Cross-references, pinned or essential
  clauses and a live preview pane were offered and **not** chosen. The existing "Preview with a
  project…" dialog stays.
- **U12. Sub-clauses are a structured list.** A module has optional intro text, then sub-clause
  rows. Each row has an optional short heading and its text, can be dragged to reorder, and can
  be indented one level. Letters are never typed: the app renders 4(a), 4(b), 7(a)(i). This
  extends the user's `{id, title, body}` shape with a `clauses` array.
- **U13. Seed.** The user's 12-module JSON, verbatim ("Quote" wording), with the typed `a.` /
  `(i)` prefixes turned into structured sub-clauses. `$63.00` becomes a `{hourly_rate}` field,
  set once in Settings → Service agreement.
- **U14. Signing is unchanged** (no user decision needed, from the code): the modules are joined
  into one numbered text, and that frozen text plus its SHA-256 is what gets signed and stored.
  Agreements already signed are untouched.

## Build order

- **U15.** System (tokens and components) → D3 builder → D1 screens (Project, Invoice, Editor)
  → D2 emails, which wait on the logo file and a NAS deploy. Each step can deploy on its own.

## From the Design Brief interview (2026-10-06)

- **U16. The Desktop Preservation Law is retired.** The Electron app is gone. `app.css` is
  editable now, and the new tokens replace its hard-coded values directly instead of adding
  another override layer. Its header comment is to be rewritten to say so.
- **U17. Philosophy: functionalist, LSC-warm.** Dieter Rams discipline (one accent, a strict 4/8px
  scale, one type scale) inside LSC's warm dark. The layers are warm near-black instead of
  today's blue-grey, and terracotta is used only for the one primary action.
- **U18. References: Linear, Stripe Dashboard, Frame.io.**
- **U19. Three fonts, each with a job.** **Metro Sans** (new, from `Visual Design/Metro-Sans---Full-Family`)
  is the reading text: paragraphs, form fields and buttons. It replaces Funnel Sans.
  **CS Felice Mono** is for eyebrow labels, UPIDs, invoice numbers and status chips. **Delight**
  stays for headings and big figures.

## From the Information Architecture interview (2026-10-06)

- **U20. Project page.** Documents is the wide main column (first on a phone). Production days
  and Activity form the side column. The Cost Breakdown and Signed agreement rows fold into their
  estimate's Documents ▾.
- **U21. The editor has 6 panels:** Job details · Deliverables · Production booking · Services
  (Pre, Post and Additional as sub-sections) · On set, by day · Summary. Job details starts
  collapsed on an existing estimate. Open and closed states are remembered per browser.
- **U22. The agreement header is filled from Settings.** The business email and phone come from
  Settings → Business (blank live today: the user fills them in). A new Business field, **Signs
  for the business**, replaces the hard-coded "represented by Lachlan Sullivan-Carey". The
  **Intro** paragraph is the header's only editable text.
- **U23. A module is called a "Clause"** ("+ Add clause", "Sub-clause").

## From the Design Tokens phase (2026-10-06)

- **U24. Money in tables and rows uses CS Felice Mono** (`--font-figures`), so the digits line up.
  Headline figures (Total, Balance due, Client total) stay in Delight.
- **U25 (from the contrast checks, no user decision).** White text on the site's terracotta
  `#C0603C` is 4.22:1, under 4.5. The primary button fill is therefore `#B4532F` (4.98:1).
  `#C0603C` stays for non-text marks (rules, the drag line).
