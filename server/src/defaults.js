'use strict';

const { PRICING_SHAPE, SURCHARGE_DEFAULTS } = require('./calc');

/**
 * The rate card and settings a fresh billing.db starts from.
 *
 * DEFAULT_PRICING is lifted verbatim from the desktop app's DEFAULT_LABOUR /
 * DEFAULT_TRAVEL arrays so the first boot of the server produces the same
 * numbers the Electron build did. Once the Pricing screen writes to the
 * database these are only used for "reset to defaults".
 *
 * `rate` is the internal cost (inert on labour rows since 2026-09-21). What the
 * client is billed is a travel row's `mu`, or a labour row's `prices` below.
 * `directCost: true` means the row is billed straight through at cost, no
 * markup, and counts as a pass-through rather than revenue.
*
 * SERVICE UNITS (2026-09-28, .design/service-rate-tiers/; this replaced the
 * day rows of 2026-09-27). A labour row is a service with three prices,
 * `prices: { hour, half, full }`: a number is a price the user set, `null` is
 * auto — derived on read by calc.js's unitDef from the income floor and Target
 * Markup, never stored. `serviceDay` says how many billable hours a full and a
 * half day on a job are; deliberately not Capacity's billable hours per day,
 * which is a yearly planning average. Labour rows carry no `mu`,
 * `hoursPerUnit` or `dayUnit` any more; PUT /api/pricing refuses one that does.
 *
 *   - Video Capture has all three prices set, $140 / $640 / $1,120: the old
 *     "— Full Day" and "— Half Day" rows folded into the one service. The half
 *     day is its own figure, not half the full day's: setup, travel and
 *     turnaround don't halve.
 *   - Every other service keeps its old price as its hourly one, with the half
 *     and full day auto. Until Profit Goals are set up those read as no price
 *     yet, which is why the defaults don't try to guess them.
 *   - Travel rows are unchanged: they are not services and have no units.
 *
 * TRANSPORT & LOGISTICS HRS IS "YOUR TIME" (2026-09-30, the user's call;
 * .design/estimate-accuracy/ task 5). They are the owner's own hours, so
 * `ownTime: true`: the whole $35 an hour is income, and the hours are billable
 * hours that carry overhead, like labour's. Before, the row read as bought in
 * at $25 and resold, so only the $10 over that was income and its hours
 * counted for nothing. With the flag set, the row's `rate` no longer means
 * anything (calc.js never reads it for an own-time row); it is left as it was
 * rather than zeroed. Only a fresh database and Reset Defaults read this: a
 * card already saved keeps its own row, and a line already on an estimate
 * keeps its own snapshot.
 *
 * AND ITS PRICE IS AUTO (2026-09-30, task 6a): `mu: null`, so it follows the
 * income floor with no markup (calc.js travelRowDef). It was $35. The card
 * carries `pricingShape` (calc.js PRICING_SHAPE) because Reset Defaults hands
 * this object straight to the Rate Card.
 *
 * THE CAR, PER KM (2026-09-30, task 6b). "Fuel & Tolls" is now "Tolls &
 * Parking": fuel is part of the car's running cost, which "Vehicle — per km"
 * bills at cost from the figure on Overhead (calc.js travelRowDef), so a
 * fuel line as well would charge for it twice. Only a fresh database and
 * Reset Defaults read this; the user renames a live row themselves.
 *
 * ADDITIONAL WORK AND SURCHARGES (2026-10-02, .design/production-booking/
 * task 4). Overtime moves out of Production into a new "Additional work"
 * section (D14): Production (id `prod`) is the one section on set (D24), and
 * Overtime is billed after a long day, never surcharged. The id `additional`
 * is what later stages look the section up by. `surcharges` is calc.js's own
 * SURCHARGE_DEFAULTS, copied rather than shared so nothing can mutate the
 * constant through the card. As above, only a fresh database and Reset
 * Defaults read either: the user moves Overtime on a live card themselves.
 */
const DEFAULT_PRICING = {
  pricingShape: PRICING_SHAPE,
  serviceDay: { fullHours: 8, halfHours: 4 },
  labourSections: [
    {
      id: 'preprod',
      label: 'Pre-Production',
      rows: [
        { name: 'Pre-Production Meeting with Client', rate: 40, prices: { hour: 56, half: null, full: null } },
        { name: 'Pre-Production Development & Admin', rate: 30, prices: { hour: 42, half: null, full: null } },
      ],
    },
    {
      id: 'prod',
      label: 'Production',
      rows: [
        { name: 'Video Capture', rate: 100, prices: { hour: 140, half: 640, full: 1120 } },
        { name: 'Photo Capture', rate: 80, prices: { hour: 112, half: null, full: null } },
        { name: 'Drone Aerial Capture', rate: 60, prices: { hour: 84, half: null, full: null } },
      ],
    },
    {
      id: 'post',
      label: 'Post-Production',
      rows: [
        { name: 'Video Editor — Project Setup', rate: 35, prices: { hour: 49, half: null, full: null } },
        { name: 'Video Editor — B-Roll Offline Edit', rate: 45, prices: { hour: 63, half: null, full: null } },
        { name: 'Video Editor — A-Roll Offline Edit', rate: 45, prices: { hour: 63, half: null, full: null } },
        { name: 'Video Editor — A-Roll RC', rate: 100, prices: { hour: 140, half: null, full: null } },
        { name: 'Video Editor — Longform RC', rate: 100, prices: { hour: 140, half: null, full: null } },
        { name: 'Video Editor — Longform AC', rate: 100, prices: { hour: 140, half: null, full: null } },
        { name: 'Video Editor — Longform Draft', rate: 100, prices: { hour: 140, half: null, full: null } },
        { name: 'Video Editor — Longform Colour', rate: 100, prices: { hour: 140, half: null, full: null } },
        { name: 'Video Editor — Longform Sound Mix/Master', rate: 100, prices: { hour: 140, half: null, full: null } },
        { name: 'Video Editor — Socials', rate: 90, prices: { hour: 126, half: null, full: null } },
        { name: 'Processed Footage Handover [Over Cloud]', rate: 35, prices: { hour: 49, half: null, full: null } },
        { name: 'Raw Footage Handover [on HDD]', rate: 70, prices: { hour: 98, half: null, full: null }, customBill: true },
        { name: 'Photo Editor', rate: 110, prices: { hour: 154, half: null, full: null } },
      ],
    },
    {
      id: 'additional',
      label: 'Additional work',
      rows: [
        { name: 'Overtime — per hour', rate: 150, prices: { hour: 210, half: null, full: null } },
      ],
    },
  ],
  travelRows: [
    { name: 'Tolls & Parking', rate: 1, mu: 1, directCost: true },
    { name: 'Vehicle — per km', rate: 0, mu: null, perKm: true, unit: 'km' },
    { name: 'Crew Meals', rate: 30, mu: 30, unit: 'meals' },
    { name: 'Transport & Logistics Hrs', rate: 25, mu: null, ownTime: true },
    { name: 'Flights & Public Transport', rate: 0, mu: 0, directCost: true },
    { name: 'Crew Accommodation', rate: 0, mu: 0, directCost: true },
  ],
  // The internal income-tax provision. Was the hardcoded TAX_RATE = 0.35 that
  // the fake "Save Rates" button could never change.
  taxSetAsideRate: 0.35,
  surcharges: Object.assign({}, SURCHARGE_DEFAULTS, { workingWeekdays: SURCHARGE_DEFAULTS.workingWeekdays.slice() }),
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
