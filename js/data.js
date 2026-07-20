// ════════════════════════════════════════════
//  DATA  —  pages/data.js
//  Edit this file to update orders, customers, sales data
// ════════════════════════════════════════════

// Today at UTC midnight — deadline strings ('YYYY-MM-DD') parse as UTC
// midnight, so this keeps day-diff math in exact whole days.
const TODAY = (() => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
})();

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
  { id:'est-wait-appr',  label:'Waiting on Approval',          cls:'s-est-wait-appr'  },
  { id:'est-appr',       label:'Estimate Approved',            cls:'s-est-appr'       },
  { id:'deposit-wait',   label:'Waiting on Deposit',           cls:'s-deposit-wait'   },
  { id:'deposit-paid',   label:'Deposit Paid',                 cls:'s-deposit-paid'   },
  { id:'order-mat',      label:'Order Materials',              cls:'s-order-mat'      },
  { id:'materials',      label:'Waiting on Materials',         cls:'s-materials'      },
  { id:'wait-cust-ship', label:'Waiting on Customer Shipment', cls:'s-wait-cust-ship' },
  { id:'build',          label:'At the Bench',                 cls:'s-build'          },
  { id:'kyle',           label:'Kyle',                         cls:'s-kyle'           },
  { id:'stevie',         label:'Stevie',                       cls:'s-stevie'         },
  { id:'vanessa',        label:'Vanessa',                      cls:'s-vanessa'        },
  { id:'etsy-bench',    label:'Etsy Order',                   cls:'s-etsy-bench'     },
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
    { id:'etsy-bench',     cls:'s-etsy-bench',     label:'Etsy Order'            },
  ]},
  { label:'Sketch',       cls:'s-sketch-group',    stages:[
    { id:'sketch-needs', cls:'s-sketch-needs', label:'Needs Sketch'                },
    { id:'sketch-wait',  cls:'s-sketch-wait',  label:'Waiting on Sketch Approval'  },
    { id:'sketch',       cls:'s-sketch',       label:'Sketch Approved'             },
  ]},
  { label:'Estimating',   cls:'s-estimate-group',  stages:[
    { id:'quote',         cls:'s-quote',         label:'Estimate Sent'        },
    { id:'est-wait-appr', cls:'s-est-wait-appr', label:'Waiting on Approval'  },
    { id:'est-appr',      cls:'s-est-appr',      label:'Estimate Approved'    },
  ]},
  { label:'Deposit',      cls:'s-deposit-group',   stages:[
    { id:'deposit-wait', cls:'s-deposit-wait', label:'Waiting on Deposit' },
    { id:'deposit-paid', cls:'s-deposit-paid', label:'Deposit Paid'       },
  ]},
  { label:'Materials',    cls:'s-materials-group', stages:[
    { id:'order-mat',      cls:'s-order-mat',      label:'Order Materials'              },
    { id:'materials',      cls:'s-materials',      label:'Waiting on Materials'         },
    { id:'wait-cust-ship', cls:'s-wait-cust-ship', label:'Waiting on Customer Shipment' },
  ]},
  { label:'At the Bench', cls:'s-build',           stages:[
    {id:'build',   cls:'s-build',   label:'Unassigned'},
    {id:'kyle',    cls:'s-kyle',    label:'Kyle'},
    {id:'stevie',  cls:'s-stevie',  label:'Stevie'},
    {id:'vanessa', cls:'s-vanessa', label:'Vanessa'},
  ]},
  { label:'Invoicing', cls:'s-needs-invoice', stages:[
    { id:'needs-invoice',  cls:'s-needs-invoice',  label:'Needs Invoicing' },
    { id:'invoice-sent',   cls:'s-invoice-sent',   label:'Invoice Sent'    },
  ]},
  { label:'Contact Customer', cls:'s-contact-group', stages:[
    { id:'contact-need', cls:'s-contact-need', label:'Need to Contact Customer' },
    { id:'contact-done', cls:'s-contact-done', label:'Contacted Customer'       },
  ]},
  { label:'Ready to Pickup/Ship', cls:'s-ready-pick',  stages:[{id:'ready-pick', cls:'s-ready-pick', label:'Ready to Pickup/Ship'}, {id:'ship-out', cls:'s-ship-out', label:'Ship Out'}], pickupSections:true },
];

// ClickUp list 901416911135 — legacy Asana IDs preserved for reference only

// ── Square Market Weekend Sales ──────────────────────────────────────────────
// Populated at runtime from /api/weekend-sales (totals section) — see
// salesFetchTotals() in js/sales.js. The baseline lives server-side in
// functions/api/weekend-sales.js; never hardcode revenue here — this file
// is served publicly.
const SQUARE_WEEKENDS = [];

// Orders are loaded from Notion on startup via notionStartupSync()
// and from localStorage as a fast cache. This array is intentionally
// empty — do not add hardcoded orders here.
const ORDERS = [];

// Populated at runtime from Notion via loadCustomersFromNotion()
const CUSTOMERS = [];

// ── Shopify shipments ────────────────────────────────────────────────────────
// Populated at runtime from /api/shopify-orders (see shopifyLoadShipments in
// js/shopify.js). Never hardcode order/customer data here — this file is
// served publicly, so anything in it is readable by anyone on the internet.
const SHOPIFY_ORDERS = [];
