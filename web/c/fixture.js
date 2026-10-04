/* A sent estimate as the public route will serve it (task 25), for building and
   reviewing the client page before that route exists (task 24). Every figure is
   already client-facing: prices carry their surcharges folded in, and nothing
   internal (floors, Cost Breakdown, take-home) has a field here, as it must
   never have one on the real reply either. Removed at task 26. */
(function () {
  'use strict';
  globalThis.LSC_FIXTURE = {
    kind: 'estimate',
    state: 'open',
    version: 1,
    upid: 'B214',
    name: 'Harbour Lights brand film',
    client: { businessName: 'Saltwater Co.', contactName: 'Priya Nair' },
    issuedOn: '2026-10-04',
    validUntil: '2026-11-03',
    latestUrl: '',
    business: {
      name: 'Lachlan Sullivan-Carey',
      abn: '22 115 427 780',
      contactName: 'Lachlan Sullivan-Carey',
      email: 'lachlan@creativelsc.com',
      phone: '0412 710 836',
    },
    deliverables: [
      { name: 'Brand film', format: '16:9', duration: '2–3 min', qty: 1 },
      { name: 'Social cutdowns', format: '9:16', duration: '30 sec', qty: 3 },
      { name: 'Behind-the-scenes stills', format: 'Photo set', duration: '', qty: 1 },
    ],
    days: [
      {
        date: '2026-10-15', status: 'confirmed', startTime: '07:00', endTime: '17:00',
        items: [
          { name: 'Director / DOP', qty: '1 full day', price: 1450 },
          { name: 'Cinema camera package', qty: '1 full day', price: 650 },
          { name: 'Sound recordist', qty: '1 full day', price: 900 },
        ],
      },
      {
        date: '2026-10-16', status: 'confirmed', startTime: '07:00', endTime: '17:00',
        items: [
          { name: 'Director / DOP', qty: '1 full day', price: 1450 },
          { name: 'Cinema camera package', qty: '1 full day', price: 650 },
        ],
      },
      {
        date: '2026-10-17', status: 'pencilled', startTime: '18:00', endTime: '02:00',
        items: [
          { name: 'Director / DOP', qty: '1 half day', price: 1088 },
          { name: 'Lighting kit', qty: '1 half day', price: 420 },
        ],
      },
      {
        date: '2026-11-03', status: 'proposed', startTime: '09:00', endTime: '13:00', unavailable: false,
        items: [
          { name: 'Pick-up shoot', qty: '1 half day', price: 725 },
        ],
      },
    ],
    sections: [
      { label: 'Pre-production', items: ['Creative treatment', 'Location scout', 'Shot list and schedule'] },
      { label: 'Post-production', items: ['Brand film edit', 'Colour grade', 'Sound mix', 'Social cutdown edits'] },
      { label: 'Equipment hire', items: ['Drone package'] },
      { label: 'Travel & accommodation', items: ['Vehicle travel'] },
    ],
    totals: { treatment: 'none', exGst: 14860, gst: 0, total: 14860 },
    disclaimer: 'The proposed dates are not locked in and other project bookings may happen before this estimate is agreed upon.',
    faqUrl: 'https://lsccreative.studio/faq.html',
  };
}());
