// ════════════════════════════════════════════
//  DATA  —  pages/data.js
//  Edit this file to update orders, customers, sales data
// ════════════════════════════════════════════

const TODAY = new Date('2026-05-20');

const STAGES = [
  { id:'intake-custom',  label:'Custom Intake',                cls:'s-intake-custom'  },
  { id:'intake-repair',  label:'Repair Intake',                cls:'s-intake-repair'  },
  { id:'needs-est',      label:'Estimate Intake',              cls:'s-needs-est'      },
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
  { id:'ready-pick',     label:'Ready for Pickup',             cls:'s-ready-pick'     },
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
    { id:'intake-custom', cls:'s-intake-custom', label:'Custom Intake'   },
    { id:'intake-repair', cls:'s-intake-repair', label:'Repair Intake'   },
    { id:'needs-est',     cls:'s-needs-est',     label:'Estimate Intake' },
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
  { label:'Contact Customer', cls:'s-contact-group', stages:[
    { id:'contact-need', cls:'s-contact-need', label:'Need to Contact Customer' },
    { id:'contact-done', cls:'s-contact-done', label:'Contacted Customer'       },
  ]},
  { label:'Ready for Pickup', cls:'s-ready-pick',  stages:[{id:'ready-pick', cls:'s-ready-pick', label:'Ready for Pickup'}], pickupSections:true },
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

const ORDERS = [
  { id:'a1', name:'Josh Goff',           desc:'Smoky Quartz Emerald Cut Ring',            stage:'complete',   deadline:'2026-06-10', price:850,  clickup:'1213592168507991', email:'jgoff@email.com',       phone:'' },
  { id:'a2', name:'Phone: 512-919-6506', desc:'14k WG Twist Flatbacks — Two Chevron',     stage:'complete',   deadline:null,        price:420,  clickup:'1213592168507993', email:'',                      phone:'512-919-6506' },
  { id:'a3', name:'Susanna Luciano',     desc:'Custom engagement ring — oval halo setting', stage:'ready-pick', deadline:'2026-05-28', price:2200, clickup:'1213592194115580', email:'susanna.l@gmail.com', phone:'', pickup:'Sunset Valley' },
  { id:'a4', name:'Nick Martello',       desc:"Men's signet ring — sterling silver",       stage:'complete',   deadline:'2026-06-02', price:380,  clickup:'1213592208795967', email:'nmartello@email.com',  phone:'' },
  { id:'a5', name:'Katy Brown',          desc:'Stacking bands set — 14k rose gold (×3)',   stage:'complete',   deadline:'2026-05-24', price:1100, clickup:'1213592208795963', email:'katy.brown@gmail.com',  phone:'' },
  { id:'a6', name:'Annaliese Walsten',   desc:'Sapphire drop earrings — 18k gold',         stage:'complete',   deadline:'2026-05-20', price:960,  clickup:'1213591500254065', email:'awalsten@email.com',    phone:'' },
  { id:'a7', name:'Corey Hunter',        desc:'Custom pendant — lab diamond solitaire',    stage:'complete',   deadline:'2026-05-01', price:1450, clickup:'1213591500254067', email:'corey.h@gmail.com',     phone:'' },
  { id:'a8', name:'Nicholas Short',      desc:'Wedding band — hammered 14k yellow gold',   stage:'delivered',  deadline:'2026-05-08', price:680,  clickup:'1213591500254069', email:'nshort@email.com',      phone:'' },
  { id:'a9', name:'Mickey',              desc:'Custom charm bracelet',                     stage:'delivered',  deadline:null,        price:320,  clickup:'1213592194115584', email:'',                      phone:'' },
];

// Populated at runtime from Notion via loadCustomersFromNotion()
const CUSTOMERS = [];

const GMAIL_THREADS = [
  { subject:'Invoice Paid — Ladybug Ring (#000464)', from:'invoicing@squareup.com', snippet:'Josh Corpus paid $70.36 for Ladybug Ring – Remaining Balance. Paid with Visa 5901, May 20 2026.', name:'Josh Corpus', email:'josh.corpus@email.com' },
  { subject:'You made a sale on Etsy — Ship by May 26', from:'transaction@etsy.com', snippet:'Congratulations! 1 item sold. Ship to Marissa Garretto, 1328 41st Ave, Kenosha WI 53144.', name:'Marissa Garretto', email:'' },
  { subject:'Square Sales Report: May 17', from:'noreply@messaging.squareup.com', snippet:'Stones Throw Studio. Sales May 17, 2026. Gross sales summary across all devices.', name:'', email:'' },
  { subject:'Ring builder upgrades', from:'hello@pencildesign.co', snippet:'New interface with cleaner, image-driven options and automatic layouts for custom jewelry builders.', name:'', email:'' },
];
