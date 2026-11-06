// Replaced by Vite at build time. Browser input never chooses this value.
export const SITE_EDITION=typeof __SITE_EDITION__==='string'?__SITE_EDITION__:'global';
export const DOMESTIC=SITE_EDITION==='cn';
export const LOBBY_URL=DOMESTIC?'https://magical-athlete-online.cn/':'https://magical-athlete.qiuh23.workers.dev/lobby/';
