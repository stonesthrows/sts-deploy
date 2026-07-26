// ════════════════════════════════════════════════════════════
//  Shared fixture data for the redesign mockups.
//  Mirrors the real app so each design is judged on real
//  information density, not lorem ipsum.
//
//  Sources: COLUMN_GROUPS + PICKUP_LOCATIONS (js/data.js),
//           cardHTML() (js/orders.js), #tab-home
//           (jewelry-workflow.html).
// ════════════════════════════════════════════════════════════

const KPIS = [
  { icon: '📋', num: '14', label: 'Active Orders',     tone: 'gold'   },
  { icon: '🔨', num: '5',  label: 'At the Bench',      tone: 'purple' },
  { icon: '⏰', num: '6',  label: 'Due This Week',     tone: 'red'    },
  { icon: '✅', num: '3',  label: 'Ready to Pick Up',  tone: 'green'  },
];

// Kanban columns — labels and order follow COLUMN_GROUPS in js/data.js.
// `hue` selects the stage color token (--s1 … --s8) defined per design.
const COLUMNS = [
  {
    label: 'Intake', hue: 's1', cards: [
      { name: 'Marisol Vega', desc: "Reset grandmother's 1.2ct old European cut into a low-profile bezel solitaire, 14k yellow",
        due: 'Due in 12d', dueCls: 'ok', price: '$2,400',
        badges: [['📍', "Studio"], ['💬', 'Instagram']] },
      { name: 'Dana Whitfield', desc: 'Repair — re-tip 4 prongs, tighten center stone, full polish',
        due: 'Due in 3d', dueCls: 'soon', price: '$180',
        badges: [['📍', 'Bell Market']] },
      { name: 'Theo Marchetti', desc: 'Estimate — matching wedding band, hammered 14k yellow, 4mm',
        due: 'Due in 21d', dueCls: 'ok', price: '$890', badges: [] },
    ]
  },
  {
    label: 'Sketch', hue: 's2', cards: [
      { name: 'Priya Raghunathan', desc: 'Sapphire trilogy ring, 18k white, milgrain edge, 2.1ct center',
        due: 'Due in 8d', dueCls: 'ok', price: '$3,150',
        badges: [['👤', 'Kyle']] },
      { name: 'Colby Nakamura', desc: 'Signet ring with family crest engraving, sterling',
        due: 'Overdue 2d', dueCls: 'late', price: '$1,275',
        badges: [['📍', 'Mueller Market']] },
    ]
  },
  {
    label: 'Estimating', hue: 's3', cards: [
      { name: 'Renee Ostrowski', desc: 'Pendant — 0.8ct pear moissanite on 18in cable chain',
        due: 'Due in 15d', dueCls: 'ok', price: '$640',
        badges: [['✓', 'Contacted Jul 22']] },
      { name: 'Aggie Lindqvist', desc: 'Resize 3 rings, sizes 6 → 7.5',
        due: 'Due in 5d', dueCls: 'soon', price: '$210', badges: [] },
    ]
  },
  {
    label: 'Deposit', hue: 's4', cards: [
      { name: 'Marcus Delacroix-Bell', desc: 'Custom cuff, 12mm sterling, hand-stamped botanical',
        due: 'Due in 18d', dueCls: 'ok', price: '$1,050',
        badges: [['👤', 'Stevie']] },
      { name: 'Yuki Tanaka', desc: 'Earrings — emerald-cut studs, 14k white, 1.4ctw',
        due: 'Due in 9d', dueCls: 'ok', price: '$780',
        badges: [['📍', 'Chaparral Crossing']] },
    ]
  },
  {
    label: 'Materials', hue: 's5', cards: [
      { name: 'Odalys Beltrán', desc: 'Bezel-set opal ring — waiting on 8mm cabochon from Stuller',
        due: 'Due in 11d', dueCls: 'ok', price: '$520',
        badges: [['👤', 'Vanessa']] },
    ]
  },
  {
    label: 'At the Bench', hue: 's6', cards: [
      { name: 'Harriet Okonkwo', desc: 'Three-stone anniversary band, channel set, 14k yellow',
        due: 'Due in 4d', dueCls: 'soon', price: '$2,890',
        badges: [['👤', 'Kyle']] },
      { name: 'Devon Applewhite', desc: 'Rebuild worn shank on 1940s filigree, preserve original detail',
        due: 'Due in 6d', dueCls: 'soon', price: '$445',
        badges: [['👤', 'Vanessa']] },
      { name: 'Sunny Petrossian', desc: 'Toe ring set, sterling, 3pc',
        due: 'Due in 10d', dueCls: 'ok', price: '$95',
        badges: [['👤', 'Stevie']] },
    ]
  },
  {
    label: 'Contact Customer', hue: 's7', cards: [
      { name: 'Blaise Toussaint', desc: 'Sketch approved — needs deposit conversation before ordering stone',
        due: 'Due in 7d', dueCls: 'soon', price: '$1,680', flag: 'Contact Customer',
        badges: [['💬', 'Referral']] },
    ]
  },
  {
    label: 'Ready to Pickup/Ship', hue: 's8', cards: [
      { name: 'Ingrid Solheim', desc: 'Pearl strand restring, 18in, knotted silk',
        due: 'Ready', dueCls: 'done', price: '$140',
        badges: [['📍', 'Sunset Valley']] },
      { name: 'Rafael Quintanilla', desc: 'Wedding set — polish + rhodium replate, both bands',
        due: 'Ready', dueCls: 'done', price: '$3,400',
        badges: [['📍', 'Studio']] },
    ]
  },
];

const NAV = [
  { section: null,        items: [['🏠', 'Dashboard', true]] },
  { section: 'Orders',    items: [['✚', 'New Order'], ['📋', 'Custom Orders', false, '6'], ['📬', 'Ready to Ship'], ['👥', 'Customers']] },
  { section: 'Inventory', items: [['📦', 'To Restock'], ['💎', 'Adjust Inventory'], ['📊', 'Production Report'], ['🔄', 'Replenishment']] },
  { section: 'Supplies',  items: [['📦', 'Order Materials'], ['📋', 'Order History'], ['🧱', 'Materials Library']] },
  { section: 'More',      items: [['🚗', 'Trips'], ['📝', 'Notes'], ['🎨', 'Designs'], ['📊', 'Sales'], ['🏆', 'Best Sellers'], ['⛓️', 'PJ Calc']] },
];

const SALES = {
  total: '$2,100', delta: '+12%', txns: '18 transactions',
  rows: [['Saturday', 'Mueller Market', '$1,240'], ['Sunday', 'Bell Market', '$860']],
};

const TRIP = { route: 'Studio → Mueller Market', miles: '14.2 mi', when: 'Fri Jul 25, 7:40 AM', ytd: '2,318 mi YTD' };

const CALENDAR = [
  ['9:00',  'Bench block — Okonkwo band',  'ok'],
  ['13:30', 'Marisol Vega — sizing',       'soon'],
  ['16:00', 'Market load-out',             'ok'],
];

const PACKAGES = [
  ['📥', 'Stuller — 8mm opal cab', 'In Transit',  'exp Jul 28', 'soon'],
  ['📥', 'Rio Grande — solder',    'Out for Delivery', 'today', 'soon'],
  ['📤', 'Ingrid Solheim',         'Delivered',   'Jul 24',    'done'],
];

const STUDIO = [
  ['Sketch',       2], ['Estimating', 2], ['Deposit', 2],
  ['Materials',    1], ['At the Bench', 3], ['Ready', 2],
];

module.exports = { KPIS, COLUMNS, NAV, SALES, TRIP, CALENDAR, PACKAGES, STUDIO };
