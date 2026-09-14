'use strict';

/**
 * The rate card and settings a fresh billing.db starts from.
 *
 * DEFAULT_PRICING is lifted verbatim from the desktop app's DEFAULT_LABOUR /
 * DEFAULT_TRAVEL arrays so the first boot of the server produces the same
 * numbers the Electron build did. Once the Pricing screen writes to the
 * database these are only used for "reset to defaults".
 *
 * `rate` is the internal cost, `mu` is the marked-up rate the client is billed.
 * `directCost: true` means the row is billed straight through at cost, no
 * markup, and counts as a pass-through rather than revenue.
 */
const DEFAULT_PRICING = {
  labourSections: [
    {
      id: 'preprod',
      label: 'Pre-Production',
      rows: [
        { name: 'Pre-Production Meeting with Client', rate: 40, mu: 56 },
        { name: 'Pre-Production Development & Admin', rate: 30, mu: 42 },
      ],
    },
    {
      id: 'prod',
      label: 'Production',
      rows: [
        { name: 'Video Capture', rate: 100, mu: 140 },
        { name: 'Photo Capture', rate: 80, mu: 112 },
        { name: 'Drone Aerial Capture', rate: 60, mu: 84 },
      ],
    },
    {
      id: 'post',
      label: 'Post-Production',
      rows: [
        { name: 'Video Editor — Project Setup', rate: 35, mu: 49 },
        { name: 'Video Editor — B-Roll Offline Edit', rate: 45, mu: 63 },
        { name: 'Video Editor — A-Roll Offline Edit', rate: 45, mu: 63 },
        { name: 'Video Editor — A-Roll RC', rate: 100, mu: 140 },
        { name: 'Video Editor — Longform RC', rate: 100, mu: 140 },
        { name: 'Video Editor — Longform AC', rate: 100, mu: 140 },
        { name: 'Video Editor — Longform Draft', rate: 100, mu: 140 },
        { name: 'Video Editor — Longform Colour', rate: 100, mu: 140 },
        { name: 'Video Editor — Longform Sound Mix/Master', rate: 100, mu: 140 },
        { name: 'Video Editor — Socials', rate: 90, mu: 126 },
        { name: 'Processed Footage Handover [Over Cloud]', rate: 35, mu: 49 },
        { name: 'Raw Footage Handover [on HDD]', rate: 70, mu: 98, customBill: true },
        { name: 'Photo Editor', rate: 110, mu: 154 },
      ],
    },
  ],
  travelRows: [
    { name: 'Fuel & Tolls', rate: 1, mu: 1, directCost: true },
    { name: 'Crew Meals', rate: 30, mu: 30, unit: 'meals' },
    { name: 'Transport & Logistics Hrs', rate: 25, mu: 35 },
    { name: 'Flights & Public Transport', rate: 0, mu: 0, directCost: true },
    { name: 'Crew Accommodation', rate: 0, mu: 0, directCost: true },
  ],
  // The internal income-tax provision. Was the hardcoded TAX_RATE = 0.35 that
  // the fake "Save Rates" button could never change.
  taxSetAsideRate: 0.35,
};

/**
 * Settings start empty rather than guessed — the Invoice Settings modal and the
 * first-run import fill them in. The GST block is the one place with real
 * defaults, and `registered: false` is the safe one: it makes the app behave
 * exactly like the desktop version until GST is deliberately switched on.
 */
const DEFAULT_SETTINGS = {
  business: { name: '', abn: '', email: '', phone: '' },
  gst: { registered: false, rate: 0.10, pricesIncludeGst: false },
  payment: { bankName: '', accountName: '', bsb: '', accountNumber: '', terms: '' },
  paths: { exportDir: '' },
};

module.exports = { DEFAULT_PRICING, DEFAULT_SETTINGS };
