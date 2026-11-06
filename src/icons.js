const paths={
  chat:'M8 18 3 21l1.2-5A8 8 0 1 1 8 18Z M8 9h.01 M12 9h.01 M16 9h.01',
  log:'M5 3h14v18H5Z M8 7h8 M8 11h8 M8 15h6',
  settings:'M9 3h6l1 4 4 1v8l-4 1-1 4H9l-1-4-4-1V8l4-1Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  island:'M12 3 21 8v9l-9 5-9-5V8Z M8 16l4-7 4 7Z',
  wood:'M12 2 6 10h3l-5 7h6v5h4v-5h6l-5-7h3Z',
  brick:'M3 8h18v12H3Z M3 14h18 M12 8v6 M7 14v6 M17 14v6',
  sheep:'M7 9a4 4 0 0 1 7-3 4 4 0 0 1 5 5 4 4 0 0 1-1 7H7a4 4 0 0 1 0-9Z M7 18v3 M16 18v3 M3 11l4 1',
  wheat:'M12 22V3 M12 8C5 8 5 3 5 3c7 0 7 5 7 5Z M12 13C5 13 5 8 5 8 M12 18C5 18 5 13 5 13 M12 8c7 0 7-5 7-5 M12 13c7 0 7-5 7-5 M12 18c7 0 7-5 7-5',
  ore:'m3 17 5-12 7-2 6 11-7 7Z M8 5l6 16 M8 5l13 9 M3 17l18-3',
  road:'M4 3h5v18H4Z M15 3h5v18h-5Z M12 3v3 M12 10v4 M12 18v3',
  settlement:'m3 11 9-8 9 8 M5 10v11h14V10 M10 21v-7h4v7',
  city:'M3 21V8h9v13 M12 21V3h9v18 M1 21h22 M6 12h3 M6 16h3 M15 7h3 M15 11h3 M15 15h3',
  development:'M6 3h13v17H6Z M3 6v17h13 M12.5 7l1.2 2.7 3 .3-2.2 2 .6 3-2.6-1.5L10 15l.5-3-2.2-2 3-.3Z',
  arrow:'M4 12h16 M14 6l6 6-6 6',
  back:'M20 12H4 M10 6l-6 6 6 6',
  users:'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3 M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M17 3a4 4 0 0 1 0 8 M22 21v-3a4 4 0 0 0-3-3',
  link:'m9 15 6-6 M7 17H6a5 5 0 0 1 0-10h4 M14 7h4a5 5 0 0 1 0 10h-4',
  dice:'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M8 7v1 M16 7v1 M12 11v2 M8 16v1 M16 16v1',
  trade:'M3 7h17 M16 3l4 4-4 4 M21 17H4 M8 13l-4 4 4 4',
  book:'M12 5C8 2 4 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1Z M12 5v16',
  reset:'M3 10a9 9 0 1 1 1 8 M3 3v7h7',
  close:'m6 6 12 12 M6 18 18 6',
  flag:'M5 22V3 M5 3c5-3 8 3 14 0v10c-6 3-9-3-14 0',
  check:'m5 12 4 4L19 6',
  bot:'M5 7h14v13H5Z M12 7V3 M9 12v2 M15 12v2 M9 17h6 M2 11v5 M22 11v5',
  zoom:'M12 5v14 M5 12h14',
  minus:'M5 12h14',
  focus:'M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M8 12h8 M12 8v8',
  follow:'M3 11h4 M17 11h4 M12 2v4 M12 16v5 M17 11a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z',
  pause:'M8 5v14 M16 5v14',
  cards:'m3 7 12-4 6 15-12 4Z M5 4l10-2',
  trophy:'M7 3h10v7a5 5 0 0 1-10 0Z M7 5H3v3a5 5 0 0 0 5 5 M17 5h4v3a5 5 0 0 1-5 5 M12 15v6 M7 21h10',
  harbor:'M12 3v17 M9 5a3 3 0 1 0 6 0 3 3 0 1 0-6 0 M3 13c0 5 4 8 9 8s9-3 9-8 M3 13l-1 4 M3 13l4 1 M21 13l1 4 M21 13l-4 1',
  anchor:'M12 3v17 M9 5a3 3 0 1 0 6 0 3 3 0 1 0-6 0 M3 13c0 5 4 8 9 8s9-3 9-8 M3 13l-1 4 M3 13l4 1 M21 13l1 4 M21 13l-4 1',
  knight:'M6 21V10l5-7h5l-1 4 4 4-4 3-3-2-2 4h7v5Z M13 7h.01',
  offline:'M4 4l16 16 M9 5a9 9 0 0 1 11 6 M4 10a9 9 0 0 0 5 9 M14 16l3 3 M12 12h.01',
  send:'m3 3 18 9-18 9 4-9Z M7 12h14',
  shield:'m12 2 8 4v6c0 5-5 9-8 10-3-1-8-5-8-10V6Z M12 7v6 M12 17h.01',
};
export const icon=(name,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.island}"/></svg>`;

const pipPositions={1:[[12,12]],2:[[7,7],[17,17]],3:[[7,7],[12,12],[17,17]],4:[[7,7],[17,7],[7,17],[17,17]],5:[[7,7],[17,7],[12,12],[7,17],[17,17]],6:[[7,6],[17,6],[7,12],[17,12],[7,18],[17,18]]};
export const dieFace=value=>`<svg class="die-face" viewBox="0 0 24 24" aria-hidden="true">${(pipPositions[value]||[]).map(([x,y])=>`<circle cx="${x}" cy="${y}" r="1.8" fill="currentColor"/>`).join('')}</svg>`;

// Original, code-drawn resource artwork. No CATAN reference images are embedded.
const illustrations={
  wood:'<ellipse cx="32" cy="55" rx="25" ry="5" fill="#244e3c" opacity=".15"/><path d="M16 35h7v19h-7zM40 34h7v20h-7zM28 31h8v27h-8z" fill="#8e6240"/><path d="m19 5 14 29H5Z" fill="#4f8c5e"/><path d="m19 16 16 27H3Z" fill="#33734f"/><path d="m44 8 14 27H30Z" fill="#6e9b60"/><path d="m44 19 16 26H28Z" fill="#3b7b51"/><path d="m32 1 15 31H17Z" fill="#40835a"/><path d="m32 13 18 30H14Z" fill="#235e43"/><path d="m32 23 20 30H12Z" fill="#2d7150"/><path d="m32 9-6 13h6M19 13l-5 12h5" stroke="#9ac58b" stroke-width="2" fill="none"/>',
  brick:'<ellipse cx="32" cy="56" rx="27" ry="4" fill="#82482d" opacity=".16"/><path d="m5 40 18-9 16 8-18 10Z" fill="#e6a075"/><path d="m5 40 16 9v12L5 52Z" fill="#b36543"/><path d="m21 49 18-10v12L21 61Z" fill="#8d4e35"/><path d="m29 39 18-9 14 8-18 10Z" fill="#d38a62"/><path d="m29 39 14 9v12l-14-9Z" fill="#b76c49"/><path d="m43 48 18-10v12L43 60Z" fill="#82472f"/><path d="m15 23 20-10 17 9-20 11Z" fill="#efb183"/><path d="m15 23 17 10v13L15 36Z" fill="#c87d54"/><path d="m32 33 20-11v13L32 46Z" fill="#995335"/><path d="m19 24 15 7 13-7" fill="none" stroke="#f7d0a8" stroke-width="2"/>',
  sheep:'<ellipse cx="31" cy="56" rx="26" ry="4" fill="#40633e" opacity=".15"/><path d="M16 40v16h5l3-16M39 40l2 16h5V40" fill="#4a5a48"/><path d="M47 21c8-3 15 1 14 8-1 8-8 14-13 11L39 29Z" fill="#53674b"/><path d="m51 24 9-7-1 12M47 25l-7-7 1 12" fill="#647957"/><path d="M10 25a10 10 0 0 1 9-13 11 11 0 0 1 18-3 10 10 0 0 1 13 13 12 12 0 0 1-1 20 12 12 0 0 1-16 7 11 11 0 0 1-16-3A12 12 0 0 1 10 25Z" fill="#fffdf0" stroke="#d5dcc0" stroke-width="2"/><path d="M17 23q-4 6 2 9M29 14q-6 4-3 9M35 31q6 3 4 9" fill="none" stroke="#e1e4cc" stroke-width="3" stroke-linecap="round"/><circle cx="54" cy="28" r="2" fill="#223b34"/>',
  wheat:'<ellipse cx="32" cy="57" rx="23" ry="3" fill="#9c7628" opacity=".15"/><path d="M30 58 20 13M32 58V5M34 58l12-43" stroke="#9e762a" stroke-width="3" fill="none" stroke-linecap="round"/><g fill="#dba942"><path d="M30 16Q18 13 21 4q11 1 9 12M31 26q-13-2-11-12 12 0 11 12M32 37q-13-1-12-12 12 0 12 12M32 18Q44 13 41 4q-11 2-9 14M32 29q13-2 12-13-12 1-12 13M33 40q14-2 13-13-12 0-13 13M22 27Q9 23 10 14q11 1 12 13M25 40q-14-4-13-14 13 2 13 14M42 33q13-2 13-12-11 0-13 12M39 46q14 0 17-10-11-3-17 10"/></g><path d="m23 52 19-4-2 8-16 2Z" fill="#b57a3e"/><path d="M32 6v34M19 16l6 23M47 25l-6 17" stroke="#f3d681" stroke-width="1.5"/>',
  ore:'<ellipse cx="32" cy="57" rx="27" ry="4" fill="#405c68" opacity=".15"/><path d="m5 44 9-25 20-9 20 18 8 23-27 9Z" fill="#7b969c"/><path d="m14 19 10 24 10-33Z" fill="#c0d0cb"/><path d="m14 19 10 24L5 44Z" fill="#607c87"/><path d="m24 43 11 17L5 44Z" fill="#476675"/><path d="m34 10 5 29-15 4Z" fill="#96adb0"/><path d="m34 10 20 18-15 11Z" fill="#d4dcd2"/><path d="m39 39 23 12-8-23Z" fill="#78949a"/><path d="M24 43 35 60l27-9-23-12Z" fill="#567985"/><path d="m41 20 8 7-8 5M12 34l3-9" stroke="#e4e8dc" stroke-width="2" fill="none"/>',
};
export const resourceIllustration=(name,cls='')=>`<svg xmlns="http://www.w3.org/2000/svg" class="resource-illustration ${cls}" viewBox="0 0 64 64" aria-hidden="true">${illustrations[name]||illustrations.ore}</svg>`;
