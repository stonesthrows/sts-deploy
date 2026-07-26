// ════════════════════════════════════════════════════════════
//  Redesign concepts 6–10. See designs-a.js for the token
//  contract and the color-mix() stage-colour approach.
// ════════════════════════════════════════════════════════════

const SANS = `-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif`;
const SERIF = `'Iowan Old Style','Palatino Linotype',Palatino,Georgia,'Times New Roman',serif`;
const MONO = `ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace`;

// ── 6. TERMINAL ───────────────────────────────────────────────
const terminal = {
  num: '06', file: '06-terminal.html', name: 'Terminal',
  thesis: 'Monospace throughout, command-bar driven, phosphor accent. Dark-native and keyboard-forward.',
  css: `
:root{
  --font:${MONO}; --font-head:${MONO}; --font-num:${MONO};
  --fs:12.5px; --radius:0px; --radius-sm:0px; --ease:steps(2,end);
  --gap:8px; --pad:16px; --view-pad:16px; --topbar-h:40px; --sidebar-w:212px;
  --greet-size:18px; --greet-weight:700; --greet-track:0;
  --title-size:12.5px; --kpi-size:26px; --col-gap:6px; --col-min:146px;
  --vs-pad:0 16px; --vs-gap:0; --head-case:uppercase; --head-track:.1em;

  --bg:#F0F4F1; --card:#FFFFFF; --card-head-bg:#E4EDE7; --card-head-fg:#12301F;
  --border:#BFD2C6; --border-soft:#D6E3DA;
  --text:#0C2016; --text2:#3E5D4C; --text3:#6E8A7B;
  --accent:#0A8F4A; --accent-ink:#FFFFFF; --accent-text:#0A7A40; --accent-soft:#DCF0E4;
  --hover:#E8F1EB; --ok:#0A8F4A; --ok-text:#0A7A40;

  --sidebar-bg:#0C2016; --sidebar-fg:#8FCFA8; --sidebar-dim:#4E7A60;
  --sidebar-hover:#123024; --sidebar-active-bg:#0A8F4A; --sidebar-active-fg:#04120A;
  --sidebar-border:1px solid #1C4030;
  --brand-mark-bg:#0A8F4A; --brand-fg:#B0E8C4;
  --topbar-bg:#FFFFFF; --subnav-bg:#E4EDE7;
  --pill-bg:#FFFFFF; --pill-border:#BFD2C6; --pill-radius:0px;
  --shadow:none; --shadow-lg:0 0 0 1px var(--accent);
  --card-border:1px solid #BFD2C6;

  --tone-gold:#F5E9C8; --tone-purple:#E4DCF2; --tone-red:#F8DED8; --tone-green:#D6EEDE;
  --chip-bg:#F0F4F1; --badge-bg:#EDF3EF; --badge-fg:#3E5D4C;
  --tag-ok-bg:#EDF3EF; --tag-ok-fg:#3E5D4C;
  --tag-soon-bg:#F8EBCC; --tag-soon-fg:#7A5A0A;
  --tag-late-bg:#F8D8D0; --tag-late-fg:#A02818;
  --tag-done-bg:#D0EEDC; --tag-done-fg:#0A6E38;
  --flag-bg:#F8EBCC; --flag-fg:#7A5A0A;

  --s1:#1E5FD0; --s2:#A88010; --s3:#C05820; --s4:#0A8F4A;
  --s5:#7038B8; --s6:#1660A0; --s7:#A88010; --s8:#0A7A90;
  --mix-head:16%; --mix-head-fg:80%; --mix-count:24%; --mix-body:0%;
  --o-card-bg:#FFFFFF;
}
:root[data-theme="dark"]{
  --bg:#050C08; --card:#0A150F; --card-head-bg:#0E1F16; --card-head-fg:#6FE8A0;
  --border:#1A3826; --border-soft:#132C1D;
  --text:#B4F0CC; --text2:#6EB88A; --text3:#4A8060;
  --accent:#2AF57C; --accent-ink:#04120A; --accent-text:#2AF57C; --accent-soft:#0C2E1A;
  --hover:#102818; --ok:#2AF57C; --ok-text:#2AF57C;
  --card-border:1px solid #1A3826;

  --sidebar-bg:#040A06; --sidebar-fg:#7ED8A0; --sidebar-dim:#3E6E50;
  --sidebar-hover:#0C1E12; --sidebar-active-bg:#2AF57C; --sidebar-active-fg:#04120A;
  --sidebar-border:1px solid #143020;
  --brand-mark-bg:#2AF57C; --brand-fg:#8FF5B8;
  --topbar-bg:#0A150F; --subnav-bg:#0A150F;
  --pill-bg:#0C1C12; --pill-border:#1A3826;
  --shadow:none; --shadow-lg:0 0 0 1px var(--accent),0 0 16px rgba(42,245,124,.16);

  --tone-gold:#2A2410; --tone-purple:#221838; --tone-red:#2E1410; --tone-green:#0C3018;
  --chip-bg:#0C1C12; --badge-bg:#0E2216; --badge-fg:#6EB88A;
  --tag-ok-bg:#0E2216; --tag-ok-fg:#6EB88A;
  --tag-soon-bg:#2E2810; --tag-soon-fg:#E8C848;
  --tag-late-bg:#331410; --tag-late-fg:#FF6E56;
  --tag-done-bg:#0C3018; --tag-done-fg:#2AF57C;
  --flag-bg:#2E2810; --flag-fg:#E8C848;

  --s1:#4E8CFF; --s2:#E8C848; --s3:#FF8A48; --s4:#2AF57C;
  --s5:#B070FF; --s6:#38A8FF; --s7:#E8C848; --s8:#28D8E8;
  --mix-head:14%; --mix-head-fg:100%; --mix-count:22%; --mix-body:0%;
  --o-card-bg:#0C1A12;
}`,
  extra: `
.brand-name::before{content:'$ '}
.brand-name{font-size:12.5px;font-weight:700;letter-spacing:-.02em}
.brand-sub::before{content:'// '}
.sb-section::before{content:'── '}
.sb-item::before{content:'';width:0}
.sb-item.active::before{content:'▸ ';margin-right:-4px;width:auto}
.sb-item{font-size:12px;padding:4px 8px}
.sb-section{font-size:9.5px;letter-spacing:.12em;padding:12px 8px 3px}
.topbar-title::before{content:'~/ '}
.greeting::before{content:'> ';color:var(--accent)}
.board-title::before{content:'> ';color:var(--accent)}
.card-head{font-size:10.5px;font-weight:700;border-bottom:1px dashed var(--border)}
.card-head span:first-child::before{content:'[ ';color:var(--text3)}
.card-head span:first-child::after{content:' ]';color:var(--text3)}
.kpi{border-radius:0;padding:11px 13px}
.kpi:hover{transform:none;box-shadow:var(--shadow-lg)}
.kpi-ico{border-radius:0;width:32px;height:32px;font-size:15px}
.kpi-lbl{font-size:9.5px;letter-spacing:.08em}
.k-col{border:1px solid var(--border)}
.k-head{border-bottom:1px solid var(--border);font-size:10px;letter-spacing:.1em}
.k-count{border-radius:0}
.k-body{padding:6px;gap:6px}
.o-card{border:1px solid var(--border);border-left:3px solid var(--sc);box-shadow:none;padding:8px 9px}
.o-card:hover{transform:none;box-shadow:var(--shadow-lg)}
.o-name{font-size:12px;font-weight:700}
.o-name::before{content:'● ';color:var(--sc)}
.o-desc{font-size:11px;line-height:1.45;color:var(--text2)}
.o-badge{border-radius:0;font-size:9.5px;border:1px solid var(--border-soft)}
.tag{border-radius:0;font-size:9.5px;padding:1px 5px;border:1px solid currentColor}
.vs-btn{font-size:11.5px;text-transform:uppercase;letter-spacing:.09em;border-radius:0;padding:9px 13px}
.vs-btn::before{content:'[';opacity:.45;margin-right:3px}
.vs-btn::after{content:']';opacity:.45;margin-left:3px}
.pill,.theme-toggle{border-radius:0;font-size:11px}
.btn{border-radius:0;font-weight:700;letter-spacing:.04em}
.studio-chip{border-radius:0}
.studio-l{font-size:9.5px;letter-spacing:.05em}
.li{border-top:1px dashed var(--border-soft)}
.k-empty{border:1px dashed var(--border);border-radius:0;font-style:normal;font-size:10.5px}
.k-empty::before{content:'— '}
.k-empty::after{content:' —'}`
};

// ── 7. CRAFT ──────────────────────────────────────────────────
const craft = {
  num: '07', file: '07-craft.html', name: 'Warm Craft',
  thesis: 'The bench itself — kraft paper and linen texture, warm neutrals, gold-foil accents, hand-drawn edges.',
  css: `
:root{
  --font:${SANS}; --font-head:${SERIF}; --font-num:${SERIF};
  --radius:10px; --radius-sm:7px; --ease:cubic-bezier(.22,1,.36,1);
  --gap:14px; --greet-size:27px; --greet-weight:400; --greet-track:-.02em;
  --title-weight:600; --kpi-size:27px;

  --bg:#EBE1D2; --card:#FBF6ED; --card-head-bg:#F2E9DA; --card-head-fg:#4E3E2A;
  --border:#D4C2A4; --border-soft:#E2D5BE;
  --text:#33281B; --text2:#6B5A44; --text3:#94836C;
  --accent:#A87526; --accent-ink:#FFF9EE; --accent-text:#8A5F17; --accent-soft:#F5E9D2;
  --hover:#F2E9DA; --ok:#5A7A46; --ok-text:#48663A;

  --sidebar-bg:#2E2419; --sidebar-fg:#D6C6AC; --sidebar-dim:#8E7C62;
  --sidebar-hover:#3A2E20; --sidebar-active-bg:#4A3A26; --sidebar-active-fg:#EFCE84;
  --sidebar-border:1px solid #453626;
  --brand-mark-bg:linear-gradient(140deg,#EFCE84,#A87526); --brand-fg:#EFCE84; --brand-weight:400;
  --topbar-bg:#FBF6ED; --subnav-bg:#F2E9DA;
  --pill-bg:#F5EFE2; --pill-border:#DDCDB0;
  --shadow:0 1px 2px rgba(51,40,27,.07),0 2px 5px rgba(51,40,27,.05);
  --shadow-lg:0 10px 24px rgba(51,40,27,.14);

  --tone-gold:#F5E4C0; --tone-purple:#E8DFEC; --tone-red:#F5DDD2; --tone-green:#DFE9D4;
  --chip-bg:#F5EFE2; --badge-bg:#F5EFE2; --badge-fg:#6B5A44;
  --tag-ok-bg:#F0E7D6; --tag-ok-fg:#6B5A44;
  --tag-soon-bg:#F7E3BC; --tag-soon-fg:#8A5F17;
  --tag-late-bg:#F2D4C6; --tag-late-fg:#9E3E1E;
  --tag-done-bg:#DDE8CE; --tag-done-fg:#4A6636;
  --flag-bg:#F7E3BC; --flag-fg:#8A5F17;

  --s1:#3E5C9E; --s2:#B08418; --s3:#BE6428; --s4:#5A8248;
  --s5:#7A5896; --s6:#356C9A; --s7:#B08418; --s8:#3A7E88;
  --mix-head:15%; --mix-head-fg:74%; --mix-count:22%; --mix-body:6%;
  --o-card-bg:#FFFCF5;
  --grain:rgba(120,95,60,.055); --grain2:rgba(120,95,60,.03);
}
:root[data-theme="dark"]{
  --bg:#15110C; --card:#211B13; --card-head-bg:#2A2218; --card-head-fg:#D8C6A6;
  --border:#3D3222; --border-soft:#2E2619;
  --text:#EFE3CE; --text2:#B4A386; --text3:#8A7A62;
  --accent:#D9A84E; --accent-ink:#1A1408; --accent-text:#E8BE72; --accent-soft:#332815;
  --hover:#2A2218; --ok:#8AB070; --ok-text:#9EC484;

  --sidebar-bg:#0F0C08; --sidebar-fg:#C4B394; --sidebar-dim:#7A6A52;
  --sidebar-hover:#1A150E; --sidebar-active-bg:#2E2416; --sidebar-active-fg:#EFCE84;
  --sidebar-border:1px solid #2A2216;
  --topbar-bg:#1A150E; --subnav-bg:#1A150E;
  --pill-bg:#241D14; --pill-border:#3D3222;
  --shadow:0 1px 3px rgba(0,0,0,.4); --shadow-lg:0 12px 28px rgba(0,0,0,.58);

  --tone-gold:#332815; --tone-purple:#2A2230; --tone-red:#331F16; --tone-green:#232E1C;
  --chip-bg:#2A2218; --badge-bg:#2A2218; --badge-fg:#B4A386;
  --tag-ok-bg:#2A2218; --tag-ok-fg:#B4A386;
  --tag-soon-bg:#3A2C14; --tag-soon-fg:#E8BE72;
  --tag-late-bg:#3A2016; --tag-late-fg:#EE9270;
  --tag-done-bg:#243218; --tag-done-fg:#9EC484;
  --flag-bg:#3A2C14; --flag-fg:#E8BE72;

  --s1:#7C98E0; --s2:#DFB44E; --s3:#E88E56; --s4:#8EBE72;
  --s5:#AE8ACE; --s6:#5E9ECE; --s7:#DFB44E; --s8:#5EB4BE;
  --mix-head:17%; --mix-head-fg:84%; --mix-count:25%; --mix-body:7%;
  --o-card-bg:#261F16;
  --grain:rgba(255,225,180,.028); --grain2:rgba(255,225,180,.016);
}`,
  extra: `
/* Linen weave — pure CSS, no image requests */
body{
  background-image:
    repeating-linear-gradient(90deg,var(--grain) 0 1px,transparent 1px 3px),
    repeating-linear-gradient(0deg,var(--grain2) 0 1px,transparent 1px 3px);
}
.card,.kpi,.k-col{
  background-image:repeating-linear-gradient(45deg,var(--grain2) 0 1px,transparent 1px 4px);
}
.greeting,.board-title{font-style:italic}
.card-head{font-family:${SERIF};font-size:13.5px;font-weight:600}
.brand-name{font-size:14.5px}
.kpi-num,.sales-num,.trip-miles,.studio-n,.o-price{font-family:${SERIF};font-weight:600}
/* Gold foil rule under the stage header */
.k-head{
  border-bottom:2px solid transparent;
  border-image:linear-gradient(90deg,var(--sc),transparent) 1;
}
.o-card{border-left-style:solid}
.btn{background:linear-gradient(140deg,var(--accent),color-mix(in srgb,var(--accent) 60%,#6A4410))}
.sb-badge{background:linear-gradient(140deg,#EFCE84,#A87526);color:#2E2419}
.tag{border-radius:20px}
.o-badge{border-radius:20px}`
};

// ── 8. SOFT ───────────────────────────────────────────────────
const soft = {
  num: '08', file: '08-soft.html', name: 'Soft',
  thesis: 'Neumorphic calm. Low contrast, extruded surfaces, generous radius — nothing shouts at you.',
  css: `
:root{
  --font:${SANS}; --font-head:${SANS}; --font-num:${SANS};
  --radius:20px; --radius-sm:13px; --ease:cubic-bezier(.22,1,.36,1);
  --gap:16px; --pad:26px; --view-pad:24px 26px 40px;
  --greet-size:25px; --greet-weight:700; --greet-track:-.025em; --kpi-size:26px;

  --bg:#E7EBF2; --card:#E7EBF2; --card-head-bg:transparent; --card-head-fg:#4C5670;
  --border:transparent; --border-soft:rgba(140,152,180,.2);
  --text:#3B455C; --text2:#69738C; --text3:#959DB4;
  --accent:#6C8BD8; --accent-ink:#FFFFFF; --accent-text:#5578CC; --accent-soft:rgba(108,139,216,.14);
  --hover:rgba(255,255,255,.6); --ok:#54B08C; --ok-text:#3F9878;
  --card-border:none;

  --sidebar-bg:#E7EBF2; --sidebar-fg:#4C5670; --sidebar-dim:#6E7690;
  --sidebar-hover:rgba(255,255,255,.55); --sidebar-active-bg:#E7EBF2; --sidebar-active-fg:#5578CC;
  --sidebar-border:none;
  --brand-mark-bg:linear-gradient(145deg,#7E9CE4,#5578CC); --brand-fg:#3B455C;
  --topbar-bg:#E7EBF2; --subnav-bg:#E7EBF2;
  --pill-bg:#E7EBF2; --pill-border:transparent;
  --shadow:6px 6px 13px rgba(163,177,200,.55),-6px -6px 13px rgba(255,255,255,.92);
  --shadow-lg:9px 9px 20px rgba(163,177,200,.6),-9px -9px 20px rgba(255,255,255,.95);
  --inset:inset 3px 3px 7px rgba(163,177,200,.55),inset -3px -3px 7px rgba(255,255,255,.9);

  --tone-gold:#F0E2C4; --tone-purple:#E2DCF0; --tone-red:#F2DCDC; --tone-green:#D8ECE2;
  --chip-bg:#E7EBF2; --badge-bg:#E7EBF2; --badge-fg:#69738C;
  --tag-ok-bg:#E1E6EF; --tag-ok-fg:#69738C;
  --tag-soon-bg:#F2E4C6; --tag-soon-fg:#8A6A20;
  --tag-late-bg:#F2D8D8; --tag-late-fg:#A84A4A;
  --tag-done-bg:#D6EAE0; --tag-done-fg:#3F8A6C;
  --flag-bg:#F2E4C6; --flag-fg:#8A6A20;

  --s1:#6C8BD8; --s2:#D8A852; --s3:#DE8A62; --s4:#54B08C;
  --s5:#A085D8; --s6:#5E9CD8; --s7:#D8A852; --s8:#5AAEC0;
  --mix-head-fg:62%; --mix-count:18%;
  --o-card-bg:#E7EBF2;
}
:root[data-theme="dark"]{
  --bg:#242832; --card:#242832; --card-head-fg:#A8B0C4;
  --border:transparent; --border-soft:rgba(255,255,255,.06);
  --text:#D3DAE8; --text2:#9AA3B8; --text3:#767E92;
  --accent:#7F9CEC; --accent-ink:#191C24; --accent-text:#93ACF2; --accent-soft:rgba(127,156,236,.16);
  --hover:rgba(255,255,255,.05); --ok:#5CC49C; --ok-text:#6ED4AC;

  --sidebar-bg:#242832; --sidebar-fg:#B4BCD0; --sidebar-dim:#767E92;
  --sidebar-hover:rgba(255,255,255,.05); --sidebar-active-bg:#242832; --sidebar-active-fg:#93ACF2;
  --brand-fg:#D3DAE8;
  --topbar-bg:#242832; --subnav-bg:#242832;
  --pill-bg:#242832;
  --shadow:6px 6px 13px rgba(14,16,22,.66),-6px -6px 13px rgba(48,54,68,.55);
  --shadow-lg:9px 9px 20px rgba(14,16,22,.72),-9px -9px 20px rgba(50,56,72,.58);
  --inset:inset 3px 3px 7px rgba(14,16,22,.66),inset -3px -3px 7px rgba(48,54,68,.5);

  --tone-gold:#3A3220; --tone-purple:#2E2A3E; --tone-red:#3A2828; --tone-green:#22362E;
  --chip-bg:#242832; --badge-bg:#242832; --badge-fg:#9AA3B8;
  --tag-ok-bg:#2A2E3A; --tag-ok-fg:#9AA3B8;
  --tag-soon-bg:#3E3420; --tag-soon-fg:#E0B863;
  --tag-late-bg:#3E2828; --tag-late-fg:#F0908E;
  --tag-done-bg:#22382E; --tag-done-fg:#6ED4AC;
  --flag-bg:#3E3420; --flag-fg:#E0B863;

  --s1:#7F9CEC; --s2:#E0B863; --s3:#EE9C72; --s4:#5CC49C;
  --s5:#B096E8; --s6:#6EACE8; --s7:#E0B863; --s8:#68BED0;
  --o-card-bg:#242832;
}`,
  extra: `
/* Soft carries the column on extrusion alone — no fills behind the stage */
.k-col{--k-head-bg:transparent; --k-body-bg:transparent}
.sidebar{box-shadow:var(--shadow)}
.topbar{border-bottom:none;box-shadow:0 4px 12px rgba(0,0,0,.04)}
.vs{border-bottom:none}
.card,.kpi{border:none;box-shadow:var(--shadow)}
.card:hover,.kpi:hover{box-shadow:var(--shadow-lg)}
.card-head{border-bottom:1px solid var(--border-soft);font-weight:700}
.k-col{box-shadow:var(--shadow);background:var(--card);padding:6px}
.k-head{padding:11px 12px 9px;letter-spacing:.06em}
.k-count{box-shadow:var(--inset);color:var(--k-head-fg)}
.k-body{background:transparent;padding:6px}
.o-card{
  border:none;border-left:none;box-shadow:var(--shadow);
  border-radius:var(--radius-sm);position:relative;overflow:hidden;
}
.o-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--sc);border-radius:4px 0 0 4px}
.o-card:hover{box-shadow:var(--shadow-lg);transform:translateY(-2px)}
.o-card{padding-left:15px}
.pill,.theme-toggle{box-shadow:var(--shadow);border:none;border-radius:20px}
.pill:hover,.theme-toggle:hover{background:var(--card);box-shadow:var(--inset)}
.icon-btn{box-shadow:var(--shadow);border:none;border-radius:11px}
.icon-btn:hover{background:var(--card);box-shadow:var(--inset)}
.btn{box-shadow:var(--shadow);border:none;border-radius:13px}
.btn:hover{filter:none;box-shadow:var(--shadow-lg)}
.btn:active{box-shadow:var(--inset)}
.sb-item.active{box-shadow:var(--inset)}
.studio-chip{border:none;box-shadow:var(--inset);border-radius:13px}
.tag{border-radius:20px;padding:3px 9px}
.o-badge{border:none;border-radius:20px;padding:3px 8px;box-shadow:var(--inset)}
.k-empty{border:none;box-shadow:var(--inset);border-radius:13px}
.kpi-ico{box-shadow:var(--shadow);border-radius:13px}
.sb-foot{border-top:1px solid var(--border-soft)}
.sb-foot button{border:none;box-shadow:var(--shadow);border-radius:11px}`
};

// ── 9. PRODUCT ────────────────────────────────────────────────
const product = {
  num: '09', file: '09-linear.html', name: 'Product',
  thesis: 'Modern SaaS discipline — hairline borders, tight neutral greys, small confident type. Dark-first.',
  css: `
:root{
  --font:${SANS}; --font-head:${SANS}; --font-num:${SANS};
  --fs:13.5px; --radius:8px; --radius-sm:6px; --ease:cubic-bezier(.4,0,.2,1);
  --gap:10px; --pad:18px; --view-pad:18px 18px 34px; --topbar-h:48px; --sidebar-w:216px;
  --greet-size:19px; --greet-weight:600; --greet-track:-.02em;
  --title-size:13.5px; --title-weight:600; --kpi-size:23px; --col-gap:8px;
  --vs-pad:0 18px; --vs-gap:1px;

  --bg:#FBFBFC; --card:#FFFFFF; --card-head-bg:#FFFFFF; --card-head-fg:#3C4048;
  --border:#E5E6E9; --border-soft:#EFEFF1;
  --text:#16171A; --text2:#61656E; --text3:#8B8F98;
  --accent:#5C67E5; --accent-ink:#FFFFFF; --accent-text:#4F5AD8; --accent-soft:#EEEFFD;
  --hover:#F5F5F7; --ok:#2A9E6E; --ok-text:#1F8A5E;

  --sidebar-bg:#F8F8F9; --sidebar-fg:#3C4048; --sidebar-dim:#8B8F98;
  --sidebar-hover:#EFEFF1; --sidebar-active-bg:#EAEBFC; --sidebar-active-fg:#4F5AD8;
  --sidebar-border:1px solid #E5E6E9;
  --brand-mark-bg:linear-gradient(145deg,#7C86F0,#4F5AD8); --brand-fg:#16171A;
  --topbar-bg:#FFFFFF; --subnav-bg:#FFFFFF;
  --pill-bg:#F5F5F7; --pill-border:#E5E6E9; --pill-radius:6px;
  --shadow:0 1px 2px rgba(16,18,22,.05);
  --shadow-lg:0 4px 14px rgba(16,18,22,.09),0 1px 3px rgba(16,18,22,.05);

  --tone-gold:#FCF1DA; --tone-purple:#EEEBFC; --tone-red:#FCE7E4; --tone-green:#E2F4EC;
  --chip-bg:#F8F8F9; --badge-bg:#F5F5F7; --badge-fg:#61656E;
  --tag-ok-bg:#F2F2F4; --tag-ok-fg:#61656E;
  --tag-soon-bg:#FDF0D8; --tag-soon-fg:#8A6412;
  --tag-late-bg:#FCE2DE; --tag-late-fg:#B0341F;
  --tag-done-bg:#DFF2E9; --tag-done-fg:#1F7A54;
  --flag-bg:#FDF0D8; --flag-fg:#8A6412;

  --s1:#4C63E0; --s2:#C08C10; --s3:#D06424; --s4:#1F9A68;
  --s5:#8848CC; --s6:#2874C0; --s7:#C08C10; --s8:#1888A8;
  --mix-head:0%; --mix-head-fg:76%; --mix-count:14%; --mix-body:3.5%;
  --o-card-bg:#FFFFFF;
}
:root[data-theme="dark"]{
  --bg:#0B0C0E; --card:#131417; --card-head-bg:#131417; --card-head-fg:#C6C9CF;
  --border:#23252B; --border-soft:#1B1D22;
  --text:#E9EAEC; --text2:#8B8F99; --text3:#686C76;
  --accent:#6E79F0; --accent-ink:#FFFFFF; --accent-text:#8B94F5; --accent-soft:#1B1D3A;
  --hover:#1A1C21; --ok:#35B584; --ok-text:#45C795;

  --sidebar-bg:#0E0F12; --sidebar-fg:#B4B8C0; --sidebar-dim:#686C76;
  --sidebar-hover:#17191D; --sidebar-active-bg:#1E2040; --sidebar-active-fg:#A0A8F8;
  --sidebar-border:1px solid #1B1D22;
  --brand-fg:#E9EAEC;
  --topbar-bg:#0E0F12; --subnav-bg:#0E0F12;
  --pill-bg:#17191D; --pill-border:#23252B;
  --shadow:0 1px 2px rgba(0,0,0,.4); --shadow-lg:0 6px 20px rgba(0,0,0,.55);

  --tone-gold:#2E2716; --tone-purple:#231F3A; --tone-red:#301C19; --tone-green:#152E24;
  --chip-bg:#17191D; --badge-bg:#1A1C21; --badge-fg:#8B8F99;
  --tag-ok-bg:#1C1E24; --tag-ok-fg:#8B8F99;
  --tag-soon-bg:#322915; --tag-soon-fg:#E0B44E;
  --tag-late-bg:#361D18; --tag-late-fg:#F08A72;
  --tag-done-bg:#15301F; --tag-done-fg:#45C795;
  --flag-bg:#322915; --flag-fg:#E0B44E;

  --s1:#7C8AF5; --s2:#DFB248; --s3:#EE8A54; --s4:#35C68C;
  --s5:#AE7EF0; --s6:#5098E8; --s7:#DFB248; --s8:#38B2D8;
  --mix-head:0%; --mix-head-fg:88%; --mix-count:20%; --mix-body:4.5%;
  --o-card-bg:#17191D;
}`,
  extra: `
.sidebar{padding-top:2px}
.sb-item{font-size:13px;padding:6px 8px;font-weight:500}
.sb-section{font-size:10.5px;letter-spacing:.06em;text-transform:none;font-weight:600}
.card-head{font-size:12.5px;font-weight:600;letter-spacing:-.005em}
.kpi{padding:12px 14px}
.kpi-ico{width:32px;height:32px;font-size:15px;border-radius:7px}
.kpi-lbl{font-size:10.5px;text-transform:none;letter-spacing:0;color:var(--text3);font-weight:500}
.k-col{border:1px solid var(--border)}
.k-head{border-bottom:1px solid var(--border);text-transform:none;font-size:12px;letter-spacing:-.005em;padding:10px 12px}
.k-count{background:var(--k-count-bg);color:inherit;font-size:10.5px}
.o-card{border:1px solid var(--border);border-left:2px solid var(--sc)}
.o-name{font-size:12.5px;font-weight:600}
.o-desc{font-size:11.5px;color:var(--text3)}
.o-badge{font-weight:500;border-radius:4px}
.tag{border-radius:4px;font-weight:600;font-size:10px}
.vs-btn{font-size:12.5px;font-weight:500;padding:9px 12px;border-radius:0}
.vs-btn.active{font-weight:600}
.btn{font-weight:500;border-radius:6px;padding:6px 13px;font-size:12.5px}
.pill,.theme-toggle{font-size:11.5px;font-weight:500}
/* Keyboard-shortcut affordance, the genre's signature */
.topbar-title::after{
  content:'⌘K';margin-left:12px;font-size:10px;font-weight:600;
  color:var(--text3);border:1px solid var(--border);
  border-radius:4px;padding:2px 6px;vertical-align:middle;
}
.studio-chip{border-radius:7px}
.card-head{border-bottom:1px solid var(--border)}`
};

// ── 10. BENTO ─────────────────────────────────────────────────
const bento = {
  num: '10', file: '10-bento.html', name: 'Bento',
  thesis: 'The dashboard as a mosaic. Mixed-size tiles, per-tile colour identity, playful proportion, fast to scan.',
  css: `
:root{
  --font:${SANS}; --font-head:${SANS}; --font-num:${SANS};
  --radius:22px; --radius-sm:15px; --ease:cubic-bezier(.22,1,.36,1);
  --gap:12px; --pad:22px; --view-pad:22px 22px 40px;
  --greet-size:27px; --greet-weight:800; --greet-track:-.032em; --kpi-size:30px;

  --bg:#EFF0F4; --card:#FFFFFF; --card-head-bg:transparent; --card-head-fg:#2A2D38;
  --border:transparent; --border-soft:rgba(25,27,34,.08);
  --text:#191B22; --text2:#5A5E6C; --text3:#8A8E9C;
  --accent:#FF6B4A; --accent-ink:#FFFFFF; --accent-text:#E2482A; --accent-soft:#FFE9E3;
  --hover:#F4F5F8; --ok:#18B87E; --ok-text:#0E9A66;
  --card-border:none;

  --sidebar-bg:#FFFFFF; --sidebar-fg:#3A3E4A; --sidebar-dim:#71768A;
  --sidebar-hover:#F2F3F7; --sidebar-active-bg:#191B22; --sidebar-active-fg:#FFFFFF;
  --sidebar-border:none;
  --brand-mark-bg:linear-gradient(145deg,#FF8A6A,#E2482A); --brand-fg:#191B22; --brand-weight:800;
  --topbar-bg:#EFF0F4; --subnav-bg:#EFF0F4;
  --pill-bg:#FFFFFF; --pill-border:transparent;
  --shadow:0 2px 8px rgba(25,27,34,.05);
  --shadow-lg:0 10px 28px rgba(25,27,34,.11);

  --tone-gold:#FFEFC4; --tone-purple:#E9E2FE; --tone-red:#FFE0DA; --tone-green:#D4F5E6;
  --chip-bg:#F4F5F8; --badge-bg:#F4F5F8; --badge-fg:#5A5E6C;
  --tag-ok-bg:#F0F1F5; --tag-ok-fg:#5A5E6C;
  --tag-soon-bg:#FFEDC8; --tag-soon-fg:#8A5E08;
  --tag-late-bg:#FFDCD6; --tag-late-fg:#C8341A;
  --tag-done-bg:#D0F2E2; --tag-done-fg:#0A7A52;
  --flag-bg:#FFDCD6; --flag-fg:#C8341A;

  --s1:#4A6CF0; --s2:#E8A80C; --s3:#FF6B4A; --s4:#18B87E;
  --s5:#9250EA; --s6:#2E8CE0; --s7:#E8A80C; --s8:#12ACC8;
  --mix-head:100%; --mix-body:7%;
  --k-solid-fg:#FFFFFF; --k-count-bg:rgba(255,255,255,.28);
  --o-card-bg:#FFFFFF;
}
:root[data-theme="dark"]{
  --bg:#0D0E12; --card:#181A21; --card-head-fg:#DCDEE6;
  --border:transparent; --border-soft:rgba(255,255,255,.07);
  --text:#ECEDF2; --text2:#9EA3B2; --text3:#767B8A;
  --accent:#FF7E5E; --accent-ink:#160806; --accent-text:#FF9478; --accent-soft:#2E1A16;
  --hover:#20232B; --ok:#2ACE92; --ok-text:#3ADCA0;

  --sidebar-bg:#131419; --sidebar-fg:#B8BCC8; --sidebar-dim:#767B8A;
  --sidebar-hover:#1D1F27; --sidebar-active-bg:#ECEDF2; --sidebar-active-fg:#131419;
  --brand-fg:#ECEDF2;
  --topbar-bg:#0D0E12; --subnav-bg:#0D0E12;
  --pill-bg:#181A21;
  --shadow:0 2px 8px rgba(0,0,0,.4); --shadow-lg:0 12px 32px rgba(0,0,0,.6);

  --tone-gold:#3A3018; --tone-purple:#2A2340; --tone-red:#3A211B; --tone-green:#123A2A;
  --chip-bg:#20232B; --badge-bg:#20232B; --badge-fg:#9EA3B2;
  --tag-ok-bg:#20232B; --tag-ok-fg:#9EA3B2;
  --tag-soon-bg:#3E3218; --tag-soon-fg:#E8B84A;
  --tag-late-bg:#3E211A; --tag-late-fg:#FF8E72;
  --tag-done-bg:#12382A; --tag-done-fg:#3ADCA0;
  --flag-bg:#3E211A; --flag-fg:#FF8E72;

  --s1:#7288F5; --s2:#E8BC3E; --s3:#FF8E6E; --s4:#2ACE92;
  --s5:#AE78F0; --s6:#4A9EEA; --s7:#E8BC3E; --s8:#2EC2DC;
  --mix-head:88%; --mix-body:8%;
  --k-solid-fg:#0D0E12; --k-count-bg:rgba(0,0,0,.22);
  --o-card-bg:#1E212A;
}`,
  extra: `
/* Bento gives each stage a saturated header band, so the label inverts */
.k-col{--k-head-fg:var(--k-solid-fg)}
.topbar{border-bottom:none}
.vs{border-bottom:none;background:transparent}
.vs-btn{border-radius:20px;border-bottom:none;margin-bottom:0;padding:7px 15px}
.vs-btn.active{background:var(--text);color:var(--bg);border-bottom-color:transparent}
.sidebar{border-right:none}
.card,.kpi{border:none;box-shadow:var(--shadow)}
.card-head{padding:14px 16px 8px;font-size:13px;font-weight:800;letter-spacing:-.015em}
.card-body{padding:0 16px 15px}
.list{padding:0 0 6px}
.li{padding:8px 16px}

/* The bento mosaic — tiles of deliberately unequal weight */
.dash-grid{
  display:grid;
  grid-template-columns:repeat(6,1fr);
  gap:var(--gap);
  align-items:stretch;
}
.dash-col{display:contents}
.dash-split{display:contents}
.dash-col > .card:nth-child(1){grid-column:span 4}
.dash-col > .card:nth-child(2){grid-column:span 2}
.dash-split > .card:nth-child(1){grid-column:span 4}
.dash-split > .card:nth-child(2){grid-column:span 2}
.dash-col:first-child > .card{grid-column:span 6}
.dash-col:last-child > .card:nth-child(1){grid-column:span 3}
.dash-col:last-child > .card:nth-child(2){grid-column:span 3}

/* Tile identity: each gets a tinted top band */
.dash-split > .card:nth-child(1){background:linear-gradient(180deg,var(--tone-green) 0,var(--card) 74px)}
.dash-split > .card:nth-child(2){background:linear-gradient(180deg,var(--tone-purple) 0,var(--card) 74px)}
.dash-col:first-child > .card:last-child{background:linear-gradient(180deg,var(--tone-gold) 0,var(--card) 74px)}
.dash-col:last-child > .card:nth-child(1){background:linear-gradient(180deg,var(--tone-red) 0,var(--card) 74px)}
.dash-col:last-child > .card:nth-child(2){background:linear-gradient(180deg,var(--tone-green) 0,var(--card) 74px)}

.kpi{border-radius:var(--radius);padding:16px 18px;flex-direction:column;align-items:flex-start;gap:14px}
.kpi-ico{width:42px;height:42px;font-size:19px;border-radius:14px}
.kpi-num{font-size:var(--kpi-size)}
.kpi-lbl{font-size:11px;text-transform:none;letter-spacing:-.005em;color:var(--text3);font-weight:600}

.k-col{box-shadow:var(--shadow);border-radius:var(--radius);overflow:hidden}
.k-head{padding:12px 14px;font-size:11px;letter-spacing:.03em;text-transform:none;font-weight:800}
.k-count{border-radius:20px;color:inherit}
.k-body{padding:10px}
.o-card{
  border:none;border-left:none;border-radius:var(--radius-sm);
  box-shadow:var(--shadow);position:relative;padding-left:14px;overflow:hidden;
}
.o-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--sc)}
.tag{border-radius:20px;padding:3px 9px;font-weight:700}
.o-badge{border:none;border-radius:20px;padding:3px 8px}
.studio-chip{border:none;background:var(--chip-bg);border-radius:var(--radius-sm);padding:13px}
.studio-grid{padding:0 16px 16px}
.btn{border-radius:20px;padding:8px 18px;font-weight:700}
.pill,.theme-toggle{border-radius:20px;box-shadow:var(--shadow)}
.icon-btn{border-radius:12px}
.sb-item{border-radius:11px}
.k-empty{border:none;background:var(--chip-bg);border-radius:var(--radius-sm)}

@media (max-width:1080px){
  .dash-grid{grid-template-columns:repeat(2,1fr)}
  .dash-col > .card,.dash-split > .card,
  .dash-col:first-child > .card,
  .dash-col:last-child > .card:nth-child(1),
  .dash-col:last-child > .card:nth-child(2){grid-column:span 2}
}`
};

module.exports = [terminal, craft, soft, product, bento];
