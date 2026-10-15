// Small process helpers for the backend (txiki.js).
//
// Notes learned the hard way:
//  * writing to a spawned process' stdin pipe never completes on this runtime,
//    so input is handed over as a *file* redirected by `sh` (`stdinFile`);
//  * `wait()` resolves to { exit_status, term_signal };
//  * spawn() throws synchronously (ENOENT) when the binary does not exist.

const LONG = 120000; // pkexec waits for a human to type a password

function errText(e) {
  return String((e && (e.message || e.code)) || e);
}

/**
 * Run a command and collect its output. Never throws.
 * @param {string[]} argv
 * @param {{ timeout?: number, stdinFile?: string }} [opts]
 */
export async function run(argv, opts = {}) {
  const { timeout = 15000, stdinFile = null } = opts;
  const cmd = stdinFile
    ? ['sh', '-c', 'f=$1; shift; exec "$@" < "$f"', 'sh', stdinFile, ...argv]
    : argv;

  let p;
  try {
    p = tjs.spawn(cmd, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  } catch (e) {
    return { ok: false, code: 127, stdout: '', stderr: errText(e), missing: true, timedOut: false };
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      p.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }, timeout);

  try {
    const [stdout, stderr, st] = await Promise.all([p.stdout.text(), p.stderr.text(), p.wait()]);
    const code = st && st.exit_status != null ? st.exit_status : st && st.term_signal ? 137 : 0;
    return { ok: code === 0 && !timedOut, code, stdout, stderr, timedOut, missing: false };
  } catch (e) {
    return { ok: false, code: 1, stdout: '', stderr: errText(e), timedOut, missing: false };
  } finally {
    clearTimeout(timer);
  }
}

export const LONG_TIMEOUT = LONG;

/** Does a path exist (any type)? */
export async function exists(path) {
  try {
    await tjs.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** First existing path of a list, or null. */
export async function firstExisting(paths) {
  for (const p of paths) {
    if (p && (await exists(p))) return p;
  }
  return null;
}

export function errorCode(e) {
  return e && e.code ? String(e.code) : '';
}
