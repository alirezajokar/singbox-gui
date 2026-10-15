// Parsing and filtering of the sing-box journal output. Pure functions (no DOM).

const ANSI = /\x1b\[[0-9;]*m/g;
const LEVEL_RE = /\b(TRACE|DEBUG|INFO|WARN|ERROR|FATAL|PANIC)\b/;

export const LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'PANIC'];

/** How the level filter maps to the lowest level that is shown. */
export const LEVEL_FILTERS = { all: 0, warn: LEVELS.indexOf('WARN'), error: LEVELS.indexOf('ERROR') };

export function levelRank(level) {
  return LEVELS.indexOf(level);
}

/**
 * One journal line, e.g.
 *   2026-10-15T08:11:11+0330 host sing-box[2417]: INFO [4021990001 12ms] router: …
 * -> { time: '08:11:11', msg: 'INFO [4021990001 12ms] router: …', level: 'INFO' }
 */
export function parseLogLine(line) {
  const clean = String(line).replace(ANSI, '');
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})\S*\s+\S+\s+[^:]+:\s*(.*)$/.exec(clean);
  const msg = m ? m[3] : clean;
  const lv = LEVEL_RE.exec(msg);
  return { date: m ? m[1] : '', time: m ? m[2] : '', msg, level: lv ? lv[1] : 'INFO' };
}

/** Whole journal text -> entries (blank lines and "-- Logs begin" markers are dropped). */
export function parseLog(text) {
  return String(text || '')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('-- '))
    .map(parseLogLine);
}

/**
 * @param {ReturnType<typeof parseLog>} entries
 * @param {{ level?: 'all'|'warn'|'error', query?: string }} [opts]
 */
export function filterLog(entries, { level = 'all', query = '' } = {}) {
  const min = LEVEL_FILTERS[level] ?? 0;
  const q = String(query).trim().toLowerCase();
  return entries.filter((e) => levelRank(e.level) >= min && (!q || e.msg.toLowerCase().includes(q)));
}
