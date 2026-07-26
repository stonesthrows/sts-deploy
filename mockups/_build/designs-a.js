// ════════════════════════════════════════════════════════════
//  Redesign concepts 1–5.
//
//  Each design supplies a complete token set for light and dark.
//  Kanban stage colours are given as eight hues (--s1…--s8) and
//  the head/body/edge treatments are derived from them with
//  color-mix(), so a design controls its whole board from eight
//  values — and dark gets hand-raised chroma rather than a naive
//  inversion, which would muddy the columns into each other.
// ════════════════════════════════════════════════════════════

const SANS = `-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif`;
const SERIF = `'Iowan Old Style','Palatino Linotype',Palatino,Georgia,'Times New Roman',serif`;
const MONO = `ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace`;

// ── 1. ATELIER ────────────────────────────────────────────────
const atelier = {
  num: '01', file: '01-atelier.html', name: 'Atelier',
  thesis: 'The current blue-and-gold identity, done properly — serif headings, real whitespace, calmer elevation.',
  css: `
:root{
  --font:${SANS}; --font-head:${SERIF}; --font-num:${SANS};
  --radius:12px; --radius-sm:8px; --ease:cubic-bezier(.22,1,.36,1);
  --gap:14px; --greet-size:25px; --greet-weight:600; --greet-track:-.015em;
  --title-weight:600;

  --bg:#EEF4F8; --card:#FFFFFF; --card-head-bg:#F6FAFC; --card-head-fg:#1D3A4A;
  --border:#D3E2EC; --border-soft:#E4EEF4;
  --text:#16303D; --text2:#4B6C7E; --text3:#7C99A9;
  --accent:#B8862B; --accent-ink:#FFFFFF; --accent-text:#8E6417; --accent-soft:#FBF3E2;
  --hover:#EDF5F9; --ok:#4E9E6E; --ok-text:#2F7A50;

  --sidebar-bg:#173442; --sidebar-fg:#C3D9E4; --sidebar-dim:#7398A9;
  --sidebar-hover:#1F4354; --sidebar-active-bg:#255064; --sidebar-active-fg:#F0DBAE;
  --sidebar-border:1px solid #234B5D;
  --brand-mark-bg:linear-gradient(140deg,#D8A94A,#8E6417); --brand-fg:#F0DBAE;
  --topbar-bg:#FFFFFF; --subnav-bg:#F6FAFC;
  --pill-bg:#F1F7FA; --pill-border:#D9E7EF;
  --shadow:0 1px 2px rgba(22,48,61,.05),0 1px 3px rgba(22,48,61,.05);
  --shadow-lg:0 10px 26px rgba(22,48,61,.11),0 3px 7px rgba(22,48,61,.06);

  --tone-gold:#FBF1DC; --tone-purple:#F0EBF8; --tone-red:#FBE7E2; --tone-green:#E4F3EA;
  --chip-bg:#F6FAFC; --badge-bg:#F2F8FB; --badge-fg:#4B6C7E;
  --tag-ok-bg:#EAF3F8; --tag-ok-fg:#3E687E;
  --tag-soon-bg:#FDF0DC; --tag-soon-fg:#8A5B12;
  --tag-late-bg:#FBE3DD; --tag-late-fg:#A63A22;
  --tag-done-bg:#E2F2E8; --tag-done-fg:#2C6B48;
  --flag-bg:#FDF0DC; --flag-fg:#8A5B12;

  --s1:#4A72E8; --s2:#C99A1E; --s3:#D4713A; --s4:#2E9A68;
  --s5:#8E5CC4; --s6:#2B6FB8; --s7:#C7912A; --s8:#1E86A8;
  --mix-head:13%; --mix-head-fg:72%; --mix-count:20%; --mix-body:5%;
  --o-card-bg:#FFFFFF;
}
:root[data-theme="dark"]{
  --bg:#0D171E; --card:#152430; --card-head-bg:#1A2C39; --card-head-fg:#CFE2ED;
  --border:#26404F; --border-soft:#1F3542;
  --text:#E4EFF5; --text2:#9BB6C4; --text3:#6E8E9E;
  --accent:#D8A94A; --accent-ink:#1A1206; --accent-text:#E8C87E; --accent-soft:#2C2416;
  --hover:#1D3241; --ok:#5FBE85; --ok-text:#79CE9B;

  --sidebar-bg:#0A131A; --sidebar-fg:#A9C4D2; --sidebar-dim:#5E7E8F;
  --sidebar-hover:#132330; --sidebar-active-bg:#1B3646; --sidebar-active-fg:#F0DBAE;
  --sidebar-border:1px solid #1C303C;
  --topbar-bg:#101D26; --subnav-bg:#101D26;
  --pill-bg:#16262F; --pill-border:#26404F;
  --shadow:0 1px 2px rgba(0,0,0,.34); --shadow-lg:0 12px 30px rgba(0,0,0,.5);

  --tone-gold:#33291A; --tone-purple:#2A2438; --tone-red:#37211D; --tone-green:#1B3327;
  --chip-bg:#1A2C39; --badge-bg:#1C2F3C; --badge-fg:#9BB6C4;
  --tag-ok-bg:#1B3040; --tag-ok-fg:#96BCD2;
  --tag-soon-bg:#392C15; --tag-soon-fg:#E5BE6E;
  --tag-late-bg:#3D2019; --tag-late-fg:#F0998A;
  --tag-done-bg:#193527; --tag-done-fg:#79CE9B;
  --flag-bg:#392C15; --flag-fg:#E5BE6E;

  --s1:#7A9BFF; --s2:#E8C05A; --s3:#F0946A; --s4:#4FCB93;
  --s5:#B48BEA; --s6:#5FA3E8; --s7:#E8BC5E; --s8:#4FBEDF;
  --mix-head:17%; --mix-head-fg:82%; --mix-count:26%; --mix-body:7%;
  --o-card-bg:#1A2C39;
}`,
  extra: `
.greeting,.board-title,.brand-name{font-style:normal}
.card-head{font-family:${SERIF};font-size:13.5px;font-weight:600}
.kpi-num,.sales-num,.trip-miles,.studio-n{font-family:${SANS}}
.k-head{border-bottom:1px solid color-mix(in srgb,var(--sc) 20%,transparent)}`
};

// ── 2. WORKBENCH ──────────────────────────────────────────────
const workbench = {
  num: '02', file: '02-workbench.html', name: 'Workbench',
  thesis: 'Information-dense and utilitarian. Minimal chrome, tabular numbers, far more orders visible per screen.',
  css: `
:root{
  --font:${SANS}; --font-head:${SANS}; --font-num:${MONO};
  --fs:13px; --radius:4px; --radius-sm:3px; --ease:cubic-bezier(.3,0,.2,1);
  --gap:8px; --pad:14px; --view-pad:14px; --topbar-h:44px; --sidebar-w:200px;
  --greet-size:17px; --greet-weight:700; --greet-track:-.01em;
  --title-size:13px; --kpi-size:22px; --col-gap:6px; --col-min:142px;
  --vs-pad:0 14px; --vs-gap:0;

  --bg:#E9EBEE; --card:#FFFFFF; --card-head-bg:#F3F4F6; --card-head-fg:#333A44;
  --border:#C6CBD3; --border-soft:#DFE2E7;
  --text:#1B1F26; --text2:#4E5762; --text3:#79828F;
  --accent:#0B6E4F; --accent-ink:#FFFFFF; --accent-text:#0B6E4F; --accent-soft:#E2F1EB;
  --hover:#EDEFF2; --ok:#0B8E5F; --ok-text:#0B7A50;

  --sidebar-bg:#20262E; --sidebar-fg:#BCC4CE; --sidebar-dim:#727C88;
  --sidebar-hover:#2A313A; --sidebar-active-bg:#0B6E4F; --sidebar-active-fg:#FFFFFF;
  --sidebar-border:1px solid #333B45;
  --brand-mark-bg:#0B6E4F; --brand-fg:#E6EAEF;
  --topbar-bg:#FFFFFF; --subnav-bg:#F3F4F6;
  --pill-bg:#F3F4F6; --pill-border:#D5DAE1; --pill-radius:3px;
  --shadow:0 1px 0 rgba(27,31,38,.06); --shadow-lg:0 2px 6px rgba(27,31,38,.13);

  --tone-gold:#FAF0D8; --tone-purple:#EDE9F6; --tone-red:#FAE4E0; --tone-green:#E2F1EB;
  --chip-bg:#F3F4F6; --badge-bg:#EFF1F4; --badge-fg:#4E5762;
  --tag-ok-bg:#EDEFF2; --tag-ok-fg:#4E5762;
  --tag-soon-bg:#FDF0D5; --tag-soon-fg:#8A6410;
  --tag-late-bg:#FBE0DA; --tag-late-fg:#A83318;
  --tag-done-bg:#DFF0E8; --tag-done-fg:#0B6E4F;
  --flag-bg:#FDF0D5; --flag-fg:#8A6410;

  --s1:#3A62D8; --s2:#B8890F; --s3:#C7602A; --s4:#128057;
  --s5:#7B45BC; --s6:#1F5FA8; --s7:#B8890F; --s8:#0D7595;
  --mix-head:15%; --mix-head-fg:78%; --mix-count:22%; --mix-body:5%;
  --o-card-bg:#FFFFFF;
}
:root[data-theme="dark"]{
  --bg:#101216; --card:#181B20; --card-head-bg:#1E2229; --card-head-fg:#C3CAD3;
  --border:#2C313A; --border-soft:#23272E;
  --text:#E2E6EB; --text2:#98A2AE; --text3:#6E7885;
  --accent:#2ABF88; --accent-ink:#04140D; --accent-text:#3FD79C; --accent-soft:#12281F;
  --hover:#22262D; --ok:#2ABF88; --ok-text:#3FD79C;

  --sidebar-bg:#0B0D11; --sidebar-fg:#AEB7C2; --sidebar-dim:#646E7B;
  --sidebar-hover:#161A20; --sidebar-active-bg:#12563E; --sidebar-active-fg:#7BEBBD;
  --sidebar-border:1px solid #1D2128;
  --brand-mark-bg:#12563E; --brand-fg:#DDE3EA;
  --topbar-bg:#14171C; --subnav-bg:#14171C;
  --pill-bg:#1B1F25; --pill-border:#2C313A;
  --shadow:0 1px 0 rgba(0,0,0,.4); --shadow-lg:0 3px 10px rgba(0,0,0,.55);

  --tone-gold:#2E2717; --tone-purple:#252131; --tone-red:#301D1A; --tone-green:#14291F;
  --chip-bg:#1E2229; --badge-bg:#20252C; --badge-fg:#98A2AE;
  --tag-ok-bg:#22272E; --tag-ok-fg:#98A2AE;
  --tag-soon-bg:#332815; --tag-soon-fg:#E0B458;
  --tag-late-bg:#361D17; --tag-late-fg:#F08E75;
  --tag-done-bg:#12281F; --tag-done-fg:#3FD79C;
  --flag-bg:#332815; --flag-fg:#E0B458;

  --s1:#6E8FF5; --s2:#DFB444; --s3:#EE8A56; --s4:#31CE93;
  --s5:#A87BE8; --s6:#5098E0; --s7:#DFB444; --s8:#3EB4D4;
  --mix-head:16%; --mix-head-fg:85%; --mix-count:25%; --mix-body:6%;
  --o-card-bg:#1C2026;
}`,
  extra: `
/* Dense mode: tighter everything, more rows on screen */
.kpi{padding:9px 11px;gap:9px}
.kpi-ico{width:30px;height:30px;font-size:14px}
.kpi-lbl{font-size:9.5px;margin-top:2px}
.card-head{padding:7px 11px;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.card-body{padding:9px 11px}
.li{padding:5px 11px;font-size:12px}
.studio-grid{padding:9px 11px;gap:6px}
.studio-chip{padding:7px 9px}
.o-card{padding:7px 9px 6px;border-radius:3px}
.o-name{font-size:12px}
.o-desc{font-size:11px;margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.o-foot{margin-top:5px}
.o-badges{margin-top:4px;gap:3px}
.k-head{padding:6px 9px;font-size:9.5px}
.k-body{padding:6px;gap:6px;min-height:120px}
.vs-btn{padding:11px 12px;border-radius:0;font-size:12px}
.sb-item{padding:5px 8px;font-size:12.5px;border-radius:3px}
.sb-section{padding:11px 8px 3px;font-size:9.5px}
.tag{font-size:9.5px;padding:1px 5px;border-radius:3px}
.o-badge{font-size:9.5px;border-radius:2px}
.pill,.theme-toggle{font-size:11px;padding:3px 9px}`
};

// ── 3. EDITORIAL ──────────────────────────────────────────────
const editorial = {
  num: '03', file: '03-editorial.html', name: 'Editorial',
  thesis: 'Laid out like a magazine. Large serif display type, generous margins, muted paper stock, one vermilion accent.',
  css: `
:root{
  --font:${SANS}; --font-head:${SERIF}; --font-num:${SERIF};
  --radius:3px; --radius-sm:2px; --ease:cubic-bezier(.22,1,.36,1);
  --gap:22px; --pad:34px; --view-pad:32px 34px 48px; --topbar-h:64px; --sidebar-w:236px;
  --greet-size:38px; --greet-weight:400; --greet-track:-.025em;
  --title-size:16px; --title-weight:400; --kpi-size:34px;
  --col-gap:16px; --vs-pad:0 34px; --vs-gap:20px;
  /* Editorial's wide margins + 16px column gap leave less track, so the
     floor drops to keep all eight stages on screen at laptop width. */
  --col-min:134px;
  --head-case:uppercase; --head-track:.12em;

  --bg:#F7F4EE; --card:#FFFDF9; --card-head-bg:transparent; --card-head-fg:#6B6154;
  --border:#DCD3C2; --border-soft:#E8E1D4;
  --text:#1F1B16; --text2:#5E564A; --text3:#8C8377;
  --accent:#A63A28; --accent-ink:#FFFDF9; --accent-text:#A63A28; --accent-soft:#F7E9E5;
  --hover:#F1ECE2; --ok:#4A7A52; --ok-text:#3D6B45;

  --sidebar-bg:#F7F4EE; --sidebar-fg:#3C362D; --sidebar-dim:#948A7C;
  --sidebar-hover:#EFE9DE; --sidebar-active-bg:transparent; --sidebar-active-fg:#A63A28;
  --sidebar-border:1px solid #DCD3C2;
  --brand-mark-bg:#1F1B16; --brand-fg:#1F1B16; --brand-weight:400;
  --topbar-bg:#F7F4EE; --subnav-bg:#F7F4EE;
  --pill-bg:transparent; --pill-border:#DCD3C2; --pill-radius:2px;
  --shadow:none; --shadow-lg:0 6px 20px rgba(31,27,22,.09);
  --card-border:1px solid #DCD3C2;

  --tone-gold:#F3E7CE; --tone-purple:#EBE5F0; --tone-red:#F7E2DC; --tone-green:#E3EEE1;
  --chip-bg:#F7F4EE; --badge-bg:transparent; --badge-fg:#5E564A;
  --tag-ok-bg:transparent; --tag-ok-fg:#8C8377;
  --tag-soon-bg:transparent; --tag-soon-fg:#9A6A14;
  --tag-late-bg:#A63A28; --tag-late-fg:#FFFDF9;
  --tag-done-bg:transparent; --tag-done-fg:#3D6B45;
  --flag-bg:#A63A28; --flag-fg:#FFFDF9;

  --s1:#2F4C9E; --s2:#9A7412; --s3:#A63A28; --s4:#3D6B45;
  --s5:#6B4A8E; --s6:#1F5A80; --s7:#9A7412; --s8:#2A6E7A;
  --o-card-bg:#FFFDF9;
}
:root[data-theme="dark"]{
  --bg:#14120F; --card:#1C1A16; --card-head-fg:#9A9084;
  --border:#332E26; --border-soft:#28241E;
  --text:#F0EADF; --text2:#B0A695; --text3:#847B6E;
  --accent:#E0654B; --accent-ink:#14120F; --accent-text:#EE7C63; --accent-soft:#2E1E19;
  --hover:#221F1A; --ok:#6FA878; --ok-text:#84BC8D;
  --card-border:1px solid #332E26;

  --sidebar-bg:#14120F; --sidebar-fg:#CFC6B8; --sidebar-dim:#7A7266;
  --sidebar-hover:#1E1B16; --sidebar-active-fg:#EE7C63;
  --sidebar-border:1px solid #332E26;
  --brand-mark-bg:#F0EADF; --brand-fg:#F0EADF;
  --topbar-bg:#14120F; --subnav-bg:#14120F;
  --pill-border:#332E26;
  --shadow:none; --shadow-lg:0 8px 26px rgba(0,0,0,.6);

  --tone-gold:#332B18; --tone-purple:#282133; --tone-red:#33201B; --tone-green:#1D2E20;
  --chip-bg:#1C1A16; --badge-fg:#B0A695;
  --tag-ok-fg:#847B6E;
  --tag-soon-fg:#D8A648;
  --tag-late-bg:#E0654B; --tag-late-fg:#14120F;
  --tag-done-fg:#84BC8D;
  --flag-bg:#E0654B; --flag-fg:#14120F;

  --s1:#7F9BEE; --s2:#D8A648; --s3:#EE7C63; --s4:#84BC8D;
  --s5:#AE8FD8; --s6:#5E9CC8; --s7:#D8A648; --s8:#5BB3BE;
  --o-card-bg:#1C1A16;
}`,
  extra: `
/* Editorial runs the board unfilled — rules and whitespace do the work */
.k-col{
  --k-head-bg:transparent; --k-head-fg:var(--sc);
  --k-count-bg:transparent; --k-body-bg:transparent;
}
.greeting{font-style:italic}
.board-title{font-style:italic}
.card-head{font-family:${SANS};font-size:10.5px;font-weight:700;border-bottom:1px solid var(--border)}
.kpi{border-radius:0;border:none;border-top:2px solid var(--text);padding:14px 0 0;background:transparent;box-shadow:none}
.kpi:hover{transform:none;box-shadow:none;border-top-color:var(--accent)}
.kpi-ico{display:none}
.kpi-num{font-size:var(--kpi-size);font-weight:400}
.kpi-lbl{font-size:10px;letter-spacing:.12em}
.k-col{box-shadow:none;border-radius:0}
.k-head{border-bottom:2px solid var(--sc);padding:0 0 7px;letter-spacing:.12em;font-size:10px;margin-bottom:10px}
.k-body{padding:0;background:transparent;gap:12px}
.o-card{border:none;border-left:none;border-top:1px solid var(--border);border-radius:0;padding:12px 0 13px;box-shadow:none;background:transparent}
.o-card:hover{transform:none;box-shadow:none;background:transparent}
.o-card:first-child{border-top:none}
.o-name{font-family:${SERIF};font-size:16px;font-weight:400;letter-spacing:-.01em}
.o-desc{font-size:12.5px;line-height:1.5;margin-top:4px}
.o-badge{border:none;padding:2px 0;margin-right:9px;text-transform:uppercase;letter-spacing:.07em;font-size:9.5px}
.o-price{font-family:${SERIF};font-size:15px;font-weight:400}
.tag{border-radius:2px;text-transform:uppercase;letter-spacing:.08em;font-size:9.5px;padding:2px 0}
.tag.late,.tag.done{padding:2px 7px}
.sb-item.active{border-left:2px solid var(--accent);margin-left:-2px;padding-left:11px;border-radius:0}
.vs-btn{padding:10px 0;font-size:11px;text-transform:uppercase;letter-spacing:.12em;border-radius:0}
.card{overflow:visible}
.card-body,.list,.studio-grid{padding-left:0;padding-right:0}
.card{background:transparent;border:none;border-top:1px solid var(--border);border-radius:0;box-shadow:none}
.card:hover{box-shadow:none}
.card-head{padding:12px 0 8px;background:transparent}
.li{padding:8px 0}
.studio-chip{background:transparent;border:none;border-left:1px solid var(--border);padding-left:11px;border-radius:0}
.brand-name{font-family:${SERIF};font-size:15px}
.brand-mark{background:transparent;border:1px solid var(--border);color:var(--text)}`
};

// ── 4. GLASS ──────────────────────────────────────────────────
const glass = {
  num: '04', file: '04-glass.html', name: 'Glass',
  thesis: 'Glassmorphic. Translucent layered surfaces over a live gradient field, backdrop blur, luminous accents.',
  css: `
:root{
  --font:${SANS}; --font-head:${SANS}; --font-num:${SANS};
  --radius:18px; --radius-sm:12px; --ease:cubic-bezier(.22,1,.36,1);
  --gap:14px; --greet-size:26px; --greet-weight:700; --greet-track:-.025em;

  --bg:#EDF0FB; --card:rgba(255,255,255,.62); --card-head-bg:rgba(255,255,255,.34);
  --card-head-fg:#2A2455;
  --border:rgba(255,255,255,.72); --border-soft:rgba(120,110,190,.16);
  --text:#221D48; --text2:#5A5288; --text3:#8781AC;
  --accent:#6D5EF8; --accent-ink:#FFFFFF; --accent-text:#5A48E8; --accent-soft:rgba(109,94,248,.13);
  --hover:rgba(255,255,255,.55); --ok:#22B48C; --ok-text:#149472;

  --sidebar-bg:rgba(255,255,255,.42); --sidebar-fg:#3A3370; --sidebar-dim:#8781AC;
  --sidebar-hover:rgba(255,255,255,.6); --sidebar-active-bg:rgba(109,94,248,.16); --sidebar-active-fg:#4A38DC;
  --sidebar-border:1px solid rgba(255,255,255,.6);
  --brand-mark-bg:linear-gradient(140deg,#8B7CFF,#5A48E8); --brand-fg:#221D48;
  --topbar-bg:rgba(255,255,255,.5); --subnav-bg:transparent;
  --pill-bg:rgba(255,255,255,.5); --pill-border:rgba(255,255,255,.75);
  --shadow:0 4px 20px rgba(70,60,150,.09);
  --shadow-lg:0 14px 40px rgba(70,60,150,.19);
  --card-border:1px solid rgba(255,255,255,.72);

  --tone-gold:rgba(250,190,90,.32); --tone-purple:rgba(150,110,245,.26);
  --tone-red:rgba(245,110,120,.26); --tone-green:rgba(60,200,150,.26);
  --chip-bg:rgba(255,255,255,.45); --badge-bg:rgba(255,255,255,.5); --badge-fg:#5A5288;
  --tag-ok-bg:rgba(255,255,255,.6); --tag-ok-fg:#5A5288;
  --tag-soon-bg:rgba(250,180,70,.26); --tag-soon-fg:#8A5A08;
  --tag-late-bg:rgba(245,90,110,.26); --tag-late-fg:#A81E3C;
  --tag-done-bg:rgba(40,195,145,.26); --tag-done-fg:#0E7A5C;
  --flag-bg:rgba(250,180,70,.3); --flag-fg:#8A5A08;

  --s1:#5A72F5; --s2:#E0A420; --s3:#F0713C; --s4:#20BC8C;
  --s5:#9B5CE8; --s6:#3C86E0; --s7:#E0A420; --s8:#20A8C8;
  --mix-head-fg:72%;
  --glass-head:rgba(255,255,255,.5); --glass-body:rgba(255,255,255,.35);
  --k-count-bg:rgba(255,255,255,.55);
  --o-card-bg:rgba(255,255,255,.66);
  --glow1:#A78BFA; --glow2:#F0A8D0; --glow3:#7DD3FC; --glow4:#FDE68A;
}
:root[data-theme="dark"]{
  --bg:#0A0818; --card:rgba(40,34,80,.5); --card-head-bg:rgba(60,52,110,.4);
  --card-head-fg:#D8D2F5;
  --border:rgba(150,138,235,.2); --border-soft:rgba(150,138,235,.13);
  --text:#EDEAFB; --text2:#A8A0D8; --text3:#7E77AC;
  --accent:#8B7CFF; --accent-ink:#0A0818; --accent-text:#A99CFF; --accent-soft:rgba(139,124,255,.18);
  --hover:rgba(90,80,160,.3); --ok:#3FD9A8; --ok-text:#4FE0B4;

  --sidebar-bg:rgba(28,22,58,.55); --sidebar-fg:#C4BDEC; --sidebar-dim:#7E77AC;
  --sidebar-hover:rgba(70,60,130,.4); --sidebar-active-bg:rgba(139,124,255,.22); --sidebar-active-fg:#C0B4FF;
  --sidebar-border:1px solid rgba(150,138,235,.16);
  --brand-fg:#EDEAFB;
  --topbar-bg:rgba(28,22,58,.5);
  --pill-bg:rgba(60,52,110,.4); --pill-border:rgba(150,138,235,.22);
  --shadow:0 4px 22px rgba(0,0,0,.35); --shadow-lg:0 16px 44px rgba(0,0,0,.55);
  --card-border:1px solid rgba(150,138,235,.2);

  --tone-gold:rgba(240,180,80,.2); --tone-purple:rgba(160,120,250,.24);
  --tone-red:rgba(245,110,130,.2); --tone-green:rgba(60,215,160,.2);
  --chip-bg:rgba(60,52,110,.35); --badge-bg:rgba(70,60,125,.4); --badge-fg:#A8A0D8;
  --tag-ok-bg:rgba(70,60,125,.45); --tag-ok-fg:#A8A0D8;
  --tag-soon-bg:rgba(240,175,70,.22); --tag-soon-fg:#F5C468;
  --tag-late-bg:rgba(245,90,120,.24); --tag-late-fg:#FF93A8;
  --tag-done-bg:rgba(50,215,160,.2); --tag-done-fg:#5FE8B8;
  --flag-bg:rgba(240,175,70,.24); --flag-fg:#F5C468;

  --s1:#7E92FF; --s2:#F0BE50; --s3:#FF9160; --s4:#3FD9A8;
  --s5:#B87DFF; --s6:#5FA5FF; --s7:#F0BE50; --s8:#48C8E8;
  --mix-head-fg:88%;
  --glass-head:rgba(45,38,88,.55); --glass-body:rgba(35,29,72,.45);
  --k-count-bg:rgba(0,0,0,.28);
  --o-card-bg:rgba(52,44,96,.55);
  --glow1:#5B21B6; --glow2:#9D174D; --glow3:#0E7490; --glow4:#3730A3;
}`,
  extra: `
/* Glass blends the stage hue into a translucent pane, not an opaque card */
.k-col{
  --k-head-bg:color-mix(in srgb,var(--sc) 22%,var(--glass-head));
  --k-body-bg:color-mix(in srgb,var(--sc) 8%,var(--glass-body));
}
body{position:relative;overflow-x:hidden}
body::before{
  content:'';position:fixed;inset:-25%;z-index:-1;pointer-events:none;
  background:
    radial-gradient(46% 42% at 18% 22%,var(--glow1) 0%,transparent 62%),
    radial-gradient(40% 38% at 82% 16%,var(--glow2) 0%,transparent 62%),
    radial-gradient(48% 45% at 72% 82%,var(--glow3) 0%,transparent 62%),
    radial-gradient(38% 36% at 26% 86%,var(--glow4) 0%,transparent 62%);
  filter:blur(52px);opacity:.62;
  animation:drift 26s ease-in-out infinite alternate;
}
@keyframes drift{
  0%{transform:translate3d(0,0,0) scale(1)}
  50%{transform:translate3d(2.5%,-2%,0) scale(1.07)}
  100%{transform:translate3d(-2%,2.5%,0) scale(1.03)}
}
@media (prefers-reduced-motion:reduce){body::before{animation:none}}
.sidebar,.topbar,.card,.kpi,.k-col,.o-card,.pill,.theme-toggle{
  backdrop-filter:blur(18px) saturate(1.7);
  -webkit-backdrop-filter:blur(18px) saturate(1.7);
}
.k-col{border:1px solid var(--border)}
.o-card{border:1px solid var(--border);border-left:3px solid var(--sc)}
.card-head{border-bottom:1px solid var(--border-soft)}
.vs{border-bottom:1px solid var(--border-soft)}
.btn{box-shadow:0 4px 16px color-mix(in srgb,var(--accent) 42%,transparent)}
.kpi-ico{backdrop-filter:none;-webkit-backdrop-filter:none}`
};

// ── 5. BRUTALIST ──────────────────────────────────────────────
const brutalist = {
  num: '05', file: '05-brutalist.html', name: 'Brutalist',
  thesis: 'Zero radius, heavy rules, hard offset shadows, monospace labels, unmixed primaries. Loud and unmistakable.',
  css: `
:root{
  --font:${SANS}; --font-head:'Helvetica Neue',Helvetica,Arial,sans-serif; --font-num:${MONO};
  --radius:0px; --radius-sm:0px; --ease:steps(1,end);
  --gap:10px; --greet-size:30px; --greet-weight:800; --greet-track:-.04em;
  --title-weight:800; --kpi-size:32px; --col-gap:10px;
  --head-case:uppercase; --head-track:.1em; --vs-gap:0;

  --bg:#F2F0E8; --card:#FFFFFF; --card-head-bg:#0D0D0D; --card-head-fg:#FFFFFF;
  --border:#0D0D0D; --border-soft:#0D0D0D;
  --text:#0D0D0D; --text2:#3E3E3E; --text3:#6B6B6B;
  --accent:#1B3FE0; --accent-ink:#FFFFFF; --accent-text:#1B3FE0; --accent-soft:#DCE2FC;
  --hover:#EAE7DC; --ok:#0F9B4E; --ok-text:#0A7A3C;
  --card-border:2px solid #0D0D0D;
  --btn-border:2px solid #0D0D0D; --btn-shadow:3px 3px 0 #0D0D0D;

  --sidebar-bg:#FFE94A; --sidebar-fg:#0D0D0D; --sidebar-dim:#5E5A2E;
  --sidebar-hover:#0D0D0D; --sidebar-active-bg:#0D0D0D; --sidebar-active-fg:#FFE94A;
  --sidebar-border:3px solid #0D0D0D;
  --brand-mark-bg:#0D0D0D; --brand-fg:#0D0D0D; --brand-weight:800;
  --topbar-bg:#FFFFFF; --subnav-bg:#F2F0E8;
  --pill-bg:#FFFFFF; --pill-border:#0D0D0D; --pill-radius:0px;
  --shadow:3px 3px 0 #0D0D0D; --shadow-lg:6px 6px 0 #0D0D0D;

  --tone-gold:#FFE94A; --tone-purple:#D8B4FE; --tone-red:#FF6B5A; --tone-green:#4ADE80;
  --chip-bg:#F2F0E8; --badge-bg:#FFFFFF; --badge-fg:#0D0D0D;
  --tag-ok-bg:#FFFFFF; --tag-ok-fg:#0D0D0D;
  --tag-soon-bg:#FFE94A; --tag-soon-fg:#0D0D0D;
  --tag-late-bg:#FF3B2F; --tag-late-fg:#FFFFFF;
  --tag-done-bg:#4ADE80; --tag-done-fg:#0D0D0D;
  --flag-bg:#FF3B2F; --flag-fg:#FFFFFF;

  --s1:#1B3FE0; --s2:#FFC400; --s3:#FF6B00; --s4:#00A85A;
  --s5:#9333EA; --s6:#0070D8; --s7:#FFC400; --s8:#00A0C0;
  --k-solid-fg:#FFFFFF; --k-solid-body:#FFFFFF;
  --k-count-bg:rgba(0,0,0,.28);
  --o-card-bg:#FFFFFF;
  --o-edge-w:6px;
}
:root[data-theme="dark"]{
  --bg:#0A0A0A; --card:#151515; --card-head-bg:#F2F0E8; --card-head-fg:#0A0A0A;
  --border:#F2F0E8; --border-soft:#F2F0E8;
  --text:#F2F0E8; --text2:#B8B5AC; --text3:#8A8780;
  --accent:#5C7CFF; --accent-ink:#0A0A0A; --accent-text:#7E97FF; --accent-soft:#1A2044;
  --hover:#1F1F1F; --ok:#3EE07E; --ok-text:#52E890;
  --card-border:2px solid #F2F0E8;
  --btn-border:2px solid #F2F0E8; --btn-shadow:3px 3px 0 #F2F0E8;

  --sidebar-bg:#D4FF3F; --sidebar-fg:#0A0A0A; --sidebar-dim:#4E5A20;
  --sidebar-hover:#0A0A0A; --sidebar-active-bg:#0A0A0A; --sidebar-active-fg:#D4FF3F;
  --sidebar-border:3px solid #F2F0E8;
  --brand-mark-bg:#0A0A0A; --brand-fg:#0A0A0A;
  --topbar-bg:#151515; --subnav-bg:#0A0A0A;
  --pill-bg:#151515; --pill-border:#F2F0E8;
  --shadow:3px 3px 0 #F2F0E8; --shadow-lg:6px 6px 0 #F2F0E8;

  --tone-gold:#D4FF3F; --tone-purple:#B07EF5; --tone-red:#FF5A48; --tone-green:#3EE07E;
  --chip-bg:#0A0A0A; --badge-bg:#151515; --badge-fg:#F2F0E8;
  --tag-ok-bg:#151515; --tag-ok-fg:#F2F0E8;
  --tag-soon-bg:#D4FF3F; --tag-soon-fg:#0A0A0A;
  --tag-late-bg:#FF3B2F; --tag-late-fg:#FFFFFF;
  --tag-done-bg:#3EE07E; --tag-done-fg:#0A0A0A;
  --flag-bg:#FF3B2F; --flag-fg:#FFFFFF;

  --s1:#5C7CFF; --s2:#E8D63A; --s3:#FF8A3C; --s4:#2FCE7E;
  --s5:#B07EF5; --s6:#3D9BFF; --s7:#E8D63A; --s8:#2FC4E8;
  --k-solid-fg:#0A0A0A; --k-solid-body:#151515;
  --k-count-bg:rgba(0,0,0,.24);
  --o-card-bg:#1A1A1A;
}`,
  extra: `
/* Brutalist takes the stage hue at full strength — no blending */
.k-col{
  --k-head-bg:var(--sc); --k-head-fg:var(--k-solid-fg);
  --k-body-bg:var(--k-solid-body);
}
.brand-name,.topbar-title,.greeting,.board-title{text-transform:uppercase}
.greeting{line-height:1}
.sb-section{font-family:${MONO};font-size:9.5px;letter-spacing:.14em}
.sb-item{font-weight:600;border:2px solid transparent}
.sb-item:hover{color:var(--sidebar-active-fg)}
.sb-item.active{border-color:var(--border)}
.sb-badge{border-radius:0;border:2px solid var(--border)}
.brand-mark{color:var(--sidebar-bg)}
.card-head{font-family:${MONO};font-size:10.5px;font-weight:700}
.kpi{border-width:2px}
.kpi:hover{transform:translate(-2px,-2px);box-shadow:var(--shadow-lg)}
.kpi-ico{border:2px solid var(--border)}
.kpi-lbl{font-family:${MONO};font-size:9.5px;letter-spacing:.08em}
.k-col{border:2px solid var(--border);box-shadow:var(--shadow)}
.k-head{font-family:${MONO};border-bottom:2px solid var(--border);font-size:10px;letter-spacing:.1em}
.k-count{border-radius:0;color:inherit}
.o-card{border:2px solid var(--border);border-left:var(--o-edge-w) solid var(--sc);box-shadow:none}
.o-card:hover{transform:translate(-2px,-2px);box-shadow:3px 3px 0 var(--border)}
.o-name{font-weight:800;text-transform:uppercase;letter-spacing:-.01em;font-size:12px}
.o-badge{border:2px solid var(--border);border-radius:0;font-family:${MONO};font-size:9px}
.tag{border-radius:0;border:2px solid var(--border);font-family:${MONO};font-size:9px;padding:1px 5px}
.o-price{font-size:13px}
.vs{border-bottom:3px solid var(--border)}
.vs-btn{font-family:${MONO};text-transform:uppercase;letter-spacing:.08em;border:2px solid transparent;border-bottom:none;font-size:11px}
.vs-btn.active{border-color:var(--border);background:var(--card);color:var(--text)}
.topbar{border-bottom:3px solid var(--border)}
.pill,.theme-toggle{border-width:2px;font-family:${MONO};font-size:10.5px;font-weight:700}
.card{border-width:2px}
.studio-chip{border:2px solid var(--border)}
.studio-l{font-family:${MONO};font-size:9.5px}
.li{border-top:2px solid var(--border)}
.li-time{font-family:${MONO}}
.icon-btn{border:2px solid transparent}
.icon-btn:hover{border-color:var(--border)}
.k-empty{border:2px dashed var(--border);font-style:normal;font-family:${MONO};text-transform:uppercase;font-size:10px}`
};

module.exports = [atelier, workbench, editorial, glass, brutalist];
