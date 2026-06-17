// ════════════════════════════════════════════
//  DATA  —  pages/data.js
//  Edit this file to update orders, customers, sales data
// ════════════════════════════════════════════

const TODAY = new Date('2026-05-20');

const STAGES = [
  { id:'intake-custom',   label:'Custom Intake',                cls:'s-intake-custom'   },
  { id:'intake-repair',   label:'Repair Intake',                cls:'s-intake-repair'   },
  { id:'needs-est',       label:'Estimate Intake',              cls:'s-needs-est'       },
  { id:'intake-website',  label:'Website Order Intake',         cls:'s-intake-website'  },
  { id:'repair',         label:'Repairs',                      cls:'s-repair'         },
  { id:'sketch-needs',   label:'Needs Sketch',                 cls:'s-sketch-needs'   },
  { id:'sketch-wait',    label:'Waiting on Sketch Approval',   cls:'s-sketch-wait'    },
  { id:'sketch',         label:'Sketch Approved',              cls:'s-sketch'         },
  { id:'quote',          label:'Estimate Sent',                cls:'s-quote'          },
  { id:'est-appr',       label:'Estimate Approved',            cls:'s-est-appr'       },
  { id:'deposit-wait',   label:'Waiting on Deposit',           cls:'s-deposit-wait'   },
  { id:'deposit-paid',   label:'Deposit Paid',                 cls:'s-deposit-paid'   },
  { id:'order-mat',      label:'Order Materials',              cls:'s-order-mat'      },
  { id:'materials',      label:'Waiting on Materials',         cls:'s-materials'      },
  { id:'build',          label:'At the Bench',                 cls:'s-build'          },
  { id:'contact-need',   label:'Need to Contact Customer',     cls:'s-contact-need'   },
  { id:'contact-done',   label:'Contacted Customer',           cls:'s-contact-done'   },
  { id:'ready-pick',     label:'Ready to Pickup/Ship',         cls:'s-ready-pick'     },
  { id:'ship-out',       label:'Ship Out',                     cls:'s-ship-out'       },
  { id:'complete',       label:'Completed',                    cls:'s-complete'       },
  // Legacy IDs kept for data-compat (migrated on load)
  { id:'inquiry',        label:'Inquiry (legacy)',             cls:'s-inquiry'        },
  { id:'wait-cust',      label:'Waiting on Customer (legacy)', cls:'s-wait-cust'      },
];

// Pickup location sub-sections (must match the form select values exactly)
const PICKUP_LOCATIONS = ['Studio', 'Bell Market', 'Mueller Market', 'Chaparral Crossing Market', 'Sunset Valley'];

// Column layout — groups stages into shared columns
const COLUMN_GROUPS = [
  { label:'Intake',       cls:'s-intake-group',    stages:[
    { id:'intake-custom',  cls:'s-intake-custom',  label:'Custom Intake'         },
    { id:'intake-repair',  cls:'s-intake-repair',  label:'Repair Intake'         },
    { id:'needs-est',      cls:'s-needs-est',      label:'Estimate Intake'       },
    { id:'intake-website', cls:'s-intake-website', label:'Website Order Intake'  },
  ]},
  { label:'Sketch',       cls:'s-sketch-group',    stages:[
    { id:'sketch-needs', cls:'s-sketch-needs', label:'Needs Sketch'                },
    { id:'sketch-wait',  cls:'s-sketch-wait',  label:'Waiting on Sketch Approval'  },
    { id:'sketch',       cls:'s-sketch',       label:'Sketch Approved'             },
  ]},
  { label:'Estimating',   cls:'s-estimate-group',  stages:[
    { id:'quote',      cls:'s-quote',      label:'Estimate Sent'       },
    { id:'est-appr',   cls:'s-est-appr',   label:'Estimate Approved'   },
  ]},
  { label:'Deposit',      cls:'s-deposit-group',   stages:[
    { id:'deposit-wait', cls:'s-deposit-wait', label:'Waiting on Deposit' },
    { id:'deposit-paid', cls:'s-deposit-paid', label:'Deposit Paid'       },
  ]},
  { label:'Materials',    cls:'s-materials-group', stages:[
    { id:'order-mat',  cls:'s-order-mat',  label:'Order Materials'      },
    { id:'materials',  cls:'s-materials',  label:'Waiting on Materials' },
  ]},
  { label:'At the Bench', cls:'s-build',           stages:[{id:'build',      cls:'s-build',      label:'At the Bench'}] },
  { label:'Needs Invoicing',      cls:'s-needs-invoice', stages:[{id:'needs-invoice', cls:'s-needs-invoice', label:'Needs Invoice / Final Payment'}] },
  { label:'Contact Customer', cls:'s-contact-group', stages:[
    { id:'contact-need', cls:'s-contact-need', label:'Need to Contact Customer' },
    { id:'contact-done', cls:'s-contact-done', label:'Contacted Customer'       },
  ]},
  { label:'Ready to Pickup/Ship', cls:'s-ready-pick',  stages:[{id:'ready-pick', cls:'s-ready-pick', label:'Ready to Pickup/Ship'}, {id:'ship-out', cls:'s-ship-out', label:'Ship Out'}], pickupSections:true },
];

// ClickUp list 901416911135 — legacy Asana IDs preserved for reference only

// ── Square Market Weekend Sales (auto-fetched, last updated May 26 2026) ─────
const SQUARE_WEEKENDS = [
  { weekend: "2026-01-17", label: "Jan 17-18", saturday: 59.54,   sunday: 1149.26, total: 1208.80,  num_transactions: 22 },
  { weekend: "2026-01-31", label: "Jan 31-Feb 1", saturday: 442.74, sunday: 903.32, total: 1346.06, num_transactions: 26 },
  { weekend: "2026-02-07", label: "Feb 7-8",   saturday: 1268.11, sunday: 1287.46, total: 2555.57,  num_transactions: 46 },
  { weekend: "2026-02-14", label: "Feb 14-15", saturday: 48.71,   sunday: 1290.55, total: 1339.26,  num_transactions: 24 },
  { weekend: "2026-02-21", label: "Feb 21-22", saturday: 1015.26, sunday: 1477.49, total: 2492.75,  num_transactions: 48 },
  { weekend: "2026-02-28", label: "Feb 28-Mar 1", saturday: 1052.32, sunday: 555.10, total: 1607.42, num_transactions: 30 },
  { weekend: "2026-03-07", label: "Mar 7-8",   saturday: 476.74,  sunday: 1351.22, total: 1827.96,  num_transactions: 30 },
  { weekend: "2026-03-14", label: "Mar 14-15", saturday: 574.16,  sunday: 2472.40, total: 3046.56,  num_transactions: 52 },
  { weekend: "2026-03-21", label: "Mar 21-22", saturday: 644.30,  sunday: 1898.64, total: 2542.94,  num_transactions: 44 },
  { weekend: "2026-03-28", label: "Mar 28-29", saturday: 721.58,  sunday: 1493.70, total: 2215.28,  num_transactions: 36 },
  { weekend: "2026-04-04", label: "Apr 4-5",   saturday: 0,       sunday: 506.34,  total: 506.34,   num_transactions: 12 },
  { weekend: "2026-04-11", label: "Apr 11-12", saturday: 832.42,  sunday: 2019.98, total: 2852.40,  num_transactions: 47 },
  { weekend: "2026-04-18", label: "Apr 18-19", saturday: 901.03,  sunday: 1572.76, total: 2473.79,  num_transactions: 51 },
  { weekend: "2026-04-25", label: "Apr 25-26", saturday: 996.44,  sunday: 1522.67, total: 2519.11,  num_transactions: 45 },
  { weekend: "2026-05-02", label: "May 2-3",   saturday: 2310.98, sunday: 2054.26, total: 4365.24,  num_transactions: 77 },
  { weekend: "2026-05-09", label: "May 9-10",  saturday: 1860.90, sunday: 3799.99, total: 5660.89,  num_transactions: 76 },
  { weekend: "2026-05-16", label: "May 16-17", saturday: 1016.10, sunday: 1513.28, total: 2529.38,  num_transactions: 45 },
  { weekend: "2026-05-23", label: "May 23-24", saturday: 907.12,  sunday: 1956.21, total: 2863.33,  num_transactions: 54 },
];

// Orders are loaded from Notion on startup via notionStartupSync()
// and from localStorage as a fast cache. This array is intentionally
// empty — do not add hardcoded orders here.
const ORDERS = [];

// Populated at runtime from Notion via loadCustomersFromNotion()
const CUSTOMERS = [];

// ── Shopify Orders 2026 (last synced 2026-06-08) ─────────────────────────────
const SHOPIFY_ORDERS = [
  {
    id: 'gid://shopify/Order/7127958323449', name: '#1147',
    createdAt: '2026-06-08', customerName: 'Gretchen Hingley',
    customerEmail: 'ghingely@gmail.com', totalPrice: 28.00, subtotalPrice: 23.00, totalTax: 0.00,
    financialStatus: 'PAID', fulfillmentStatus: 'FULFILLED',
    shippingAddress: { city: 'Bend', province: 'OR', zip: '97703' },
    lineItems: [
      { title: 'Chevron Stackable Ring', quantity: 1, unitPrice: 23.00, variant: 'Size 6 / Gold Fill / Arrow Point' }
    ],
    tracking: { company: 'USPS', number: '9400150106151262058002', shippedAt: '2026-06-08' }
  },
  {
    id: 'gid://shopify/Order/7105999044857', name: '#1146',
    createdAt: '2026-05-27', customerName: 'Amaya Leon',
    customerEmail: 'aleon2201@gmail.com', totalPrice: 27.06, subtotalPrice: 20.00, totalTax: 2.06,
    financialStatus: 'PAID', fulfillmentStatus: 'FULFILLED',
    shippingAddress: { city: 'Austin', province: 'TX', zip: '78759' },
    lineItems: [
      { title: 'Wide Stackable Ring', quantity: 1, unitPrice: 20.00, variant: 'Size 7 / Silver / Smooth' }
    ],
    tracking: { company: 'USPS', number: '9400150106151246800658', shippedAt: '2026-05-28' }
  },
  {
    id: 'gid://shopify/Order/7021783974137', name: '#1145',
    createdAt: '2026-04-30', customerName: 'Michele Williams McLellan',
    customerEmail: 'michelewilliamsmclellan@yahoo.com', totalPrice: 45.00, subtotalPrice: 40.00, totalTax: 0.00,
    financialStatus: 'PAID', fulfillmentStatus: 'FULFILLED',
    shippingAddress: { city: 'Centennial', province: 'CO', zip: '80015' },
    lineItems: [
      { title: 'Thin Stackable Ring', quantity: 1, unitPrice: 20.00, variant: 'Size 8 / Gold Fill / Smooth' },
      { title: 'Thin Stackable Ring', quantity: 1, unitPrice: 20.00, variant: 'Size 8 / Gold Fill / Arrow Point' }
    ],
    tracking: { company: 'USPS', number: '9400150106151208086205', shippedAt: '2026-05-02' }
  },
  {
    id: 'gid://shopify/Order/6995620823289', name: '#1144',
    createdAt: '2026-04-22', customerName: 'Erica Abeyta',
    customerEmail: 'e_abeyta10@yahoo.com', totalPrice: 50.00, subtotalPrice: 50.00, totalTax: 0.00,
    financialStatus: 'PAID', fulfillmentStatus: 'FULFILLED',
    shippingAddress: null,
    lineItems: [
      { title: 'Stones Throw Studio Gift Card', quantity: 1, unitPrice: 50.00, variant: '$50.00' }
    ],
    tracking: null
  },
  {
    id: 'gid://shopify/Order/6995570622713', name: '#1143',
    createdAt: '2026-04-22', customerName: 'Sarah Tinsley',
    customerEmail: 'sarah.tinsley1@gmail.com', totalPrice: 55.00, subtotalPrice: 50.00, totalTax: 0.00,
    financialStatus: 'PAID', fulfillmentStatus: 'FULFILLED',
    shippingAddress: { city: 'Jackson', province: 'MO', zip: '63755' },
    lineItems: [
      { title: 'Wide Stackable Ring', quantity: 2, unitPrice: 25.00, variant: 'Size 2 / Gold Fill / Smooth' }
    ],
    tracking: { company: 'USPS', number: '9400150206217664209424', shippedAt: '2026-04-27' }
  },
  {
    id: 'gid://shopify/Order/6992300048633', name: '#1142',
    createdAt: '2026-04-20', customerName: 'Allison Pala',
    customerEmail: 'pala.allison@gmail.com', totalPrice: 70.00, subtotalPrice: 65.00, totalTax: 0.00,
    financialStatus: 'PAID', fulfillmentStatus: 'FULFILLED',
    shippingAddress: { city: 'Portland', province: 'ME', zip: '04101' },
    lineItems: [
      { title: 'Running Hare Pendant', quantity: 1, unitPrice: 65.00, variant: null }
    ],
    tracking: { company: 'USPS', number: '9400150106151193910509', shippedAt: '2026-04-22' }
  },
];

const GMAIL_THREADS = [
  { subject:'Invoice Paid — Ladybug Ring (#000464)', from:'invoicing@squareup.com', snippet:'Josh Corpus paid $70.36 for Ladybug Ring – Remaining Balance. Paid with Visa 5901, May 20 2026.', name:'Josh Corpus', email:'josh.corpus@email.com' },
  { subject:'You made a sale on Etsy — Ship by May 26', from:'transaction@etsy.com', snippet:'Congratulations! 1 item sold. Ship to Marissa Garretto, 1328 41st Ave, Kenosha WI 53144.', name:'Marissa Garretto', email:'' },
  { subject:'Square Sales Report: May 17', from:'noreply@messaging.squareup.com', snippet:'Stones Throw Studio. Sales May 17, 2026. Gross sales summary across all devices.', name:'', email:'' },
  { subject:'Ring builder upgrades', from:'hello@pencildesign.co', snippet:'New interface with cleaner, image-driven options and automatic layouts for custom jewelry builders.', name:'', email:'' },
];
