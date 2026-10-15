// Dashboard: one big power button, service facts, and live logs.

import { h, icon, button, card, notice, pill, toggle, select, mount, clear, toast } from '../dom.js';
import { t } from '../i18n.js';
import * as api from '../api.js';
import * as store from '../store.js';
import { runService, showFailure } from '../ui/actions.js';
import { formatDuration, formatBytes } from '../util.js';
import { inbounds, outbounds, getRules, dnsServers, ruleSets } from '../config.js';

const ANSI = /\x1b\[[0-9;]*m/g;

function parseLogLine(line) {
  const clean = line.replace(ANSI, '');
  // 2026-10-15T08:11:11+0330 host sing-box[2417]: INFO [..] message
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})\S*\s+\S+\s+[^:]+:\s*(.*)$/.exec(clean);
  const time = m ? m[2] : '';
  const msg = m ? m[3] : clean;
  const lv = /\b(TRACE|DEBUG|INFO|WARN|ERROR|FATAL|PANIC)\b/.exec(msg);
  return { time, msg, level: lv ? lv[1] : 'INFO' };
}

export const dashboard = {
  id: 'dashboard',
  icon: 'home',
  render(view, ctx) {
    const hero = h('div');
    const tiles = h('div', { class: 'grid cols-3' });
    const alerts = h('div', { class: 'col' });
    const logsBox = h('div');
    let uptimeEl = null;
    let ticker = null;
    let logTimer = null;
    let logLines = Number(sessionStorage.getItem('sbgui:loglines') || 150);
    let autoLogs = true;
    let logsDenied = false;

    mount(view, h('div', { class: 'view-inner' }, alerts, hero, tiles, logsBox));

    // ---------------------------------------------------------- hero
    function heroState() {
      const s = store.state.status;
      if (!s || !s.available) return { kind: 'off', title: t('dash.unavailable'), text: t('dash.unavailable-hint') };
      if (!s.loaded) return { kind: 'off', title: t('dash.not-found'), text: t('dash.not-found-hint', { unit: store.state.settings.unit }) };
      if (store.state.busy === 'start' || s.state === 'activating') return { kind: 'busy', title: t('dash.starting'), text: '' };
      if (store.state.busy === 'stop' || s.state === 'deactivating') return { kind: 'busy', title: t('dash.stopping'), text: '' };
      if (store.state.busy === 'restart') return { kind: 'busy', title: t('dash.restarting'), text: '' };
      if (s.active) return { kind: 'on', title: t('dash.running'), text: t('dash.running-hint') };
      if (s.state === 'failed') return { kind: 'bad', title: t('dash.failed'), text: t('dash.failed-hint') };
      return { kind: 'off', title: t('dash.stopped'), text: t('dash.stopped-hint') };
    }

    function renderHero() {
      const s = store.state.status;
      const st = heroState();
      const canAct = s && s.loaded && st.kind !== 'busy';
      const power = h(
        'button',
        {
          type: 'button',
          class: `power ${st.kind === 'on' ? 'on' : st.kind === 'bad' ? 'bad' : st.kind === 'busy' ? 'busy' : ''}`.trim(),
          title: st.kind === 'on' ? t('dash.turn-off') : t('dash.turn-on'),
          'aria-label': st.kind === 'on' ? t('dash.turn-off') : t('dash.turn-on'),
          disabled: !canAct,
          onclick: () => runService(s.active ? 'stop' : 'start'),
        },
        icon('power'),
      );

      const meta = h('div', { class: 'hero-meta' });
      uptimeEl = null;
      if (s && s.active) {
        uptimeEl = pill(formatDuration(Date.now() / 1000 - s.since), 'direct', 'clock', { ltr: true });
        meta.append(uptimeEl);
        if (s.pid) meta.append(pill(`PID ${s.pid}`, 'neutral', 'cpu', { ltr: true }));
        if (s.memory) meta.append(pill(formatBytes(s.memory), 'neutral', 'layers', { ltr: true }));
      }
      const v = store.singboxVersion();
      if (v) meta.append(pill(`sing-box ${v}`, 'info', 'box', { ltr: true }));
      if (s && s.restarts) meta.append(pill(t('dash.restarts', { n: s.restarts }), 'warn', 'refresh'));

      const actions = h('div', { class: 'hero-actions' });
      if (s && s.loaded) {
        actions.append(
          button({ label: t('dash.restart'), icon: 'restart', disabled: !canAct, onClick: () => runService('restart') }),
        );
        if (s.state === 'failed') actions.append(button({ label: t('dash.reset-failed'), icon: 'refresh', onClick: () => runService('reset-failed') }));
      }

      mount(hero, h('div', { class: `card hero ${st.kind === 'on' ? 'on' : st.kind === 'bad' ? 'bad' : ''}`.trim() }, power, h('div', { class: 'hero-text' }, h('h2', null, st.title), st.text ? h('p', null, st.text) : null, meta, actions)));
    }

    // ---------------------------------------------------------- tiles
    function renderTiles() {
      const s = store.state.status;
      const d = store.state.draft;
      const chk = store.state.lastCheck;

      const bootTile = h(
        'div',
        { class: 'card tile' },
        h('div', { class: 'k' }, t('dash.autostart')),
        h('div', { class: 'row' }, h('div', { class: 'v grow', style: { fontSize: '15px' } }, s && s.enabled ? t('dash.autostart-on') : t('dash.autostart-off')), toggle({ checked: !!(s && s.enabled), disabled: !s || !s.loaded || !!store.state.busy, onChange: async (on, el) => { el.disabled = true; await runService(on ? 'enable' : 'disable'); } })),
        h('div', { class: 'muted', style: { fontSize: '12px' } }, t('dash.autostart-hint')),
      );

      const chkPill = !chk ? pill(t('dash.not-checked'), 'neutral') : chk.ok ? pill(chk.skipped ? t('dash.check-skipped') : t('dash.valid'), chk.skipped ? 'warn' : 'direct', 'check') : pill(t('dash.invalid'), 'danger', 'alert');
      const cfgTile = h(
        'div',
        { class: 'card tile' },
        h('div', { class: 'k' }, t('dash.config')),
        h('div', { class: 'v mono', dir: 'ltr', style: { fontSize: '12.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'start' }, title: store.state.settings.configPath }, store.state.settings.configPath),
        h('div', { class: 'row wrap' }, chkPill, h('span', { class: 'grow' }), button({ label: t('dash.check'), size: 'sm', icon: 'check', onClick: async () => {
          const r = await store.checkNow();
          const problems = store.findProblems();
          if (!r.ok) notifyInvalid(r);
          else if (problems.length) {
            store.state.lastCheck = { ...r, ok: false };
            toast(t('refs.title'), 'error', problems.slice(0, 6).map((p) => `${t(`refs.kind.${p.kind}`)} «${p.tag}» ← ${p.where}`).join('\n'));
          } else toast(t('dash.check-ok'));
          renderTiles();
        } })),
      );

      const counts = d
        ? [
            [t('dash.outbounds'), outbounds(d).filter((o) => !['selector', 'urltest', 'direct', 'block', 'dns'].includes(o.type)).length],
            [t('dash.rules'), (getRules(d, 'route') || []).filter((r) => !r.__off).length],
            [t('dash.dns-servers'), dnsServers(d).length],
            [t('dash.rule-sets'), ruleSets(d).length],
          ]
        : [];
      const ports = d ? inbounds(d).map((i) => (i.listen_port ? `${i.type}:${i.listen_port}` : i.type)) : [];
      const overview = h(
        'div',
        { class: 'card tile' },
        h('div', { class: 'k' }, t('dash.overview')),
        h('div', { class: 'row wrap', style: { gap: '14px' } }, counts.map(([k, v]) => h('div', null, h('div', { class: 'v', style: { fontSize: '18px' } }, String(v)), h('div', { class: 'muted', style: { fontSize: '11.5px' } }, k)))),
        ports.length ? h('div', { class: 'tag-list' }, ports.map((p) => pill(p, 'flat'))) : null,
      );

      mount(tiles, bootTile, cfgTile, overview);
    }

    function notifyInvalid(r) {
      showFailure({ stage: 'check', message: r.output });
    }

    // ---------------------------------------------------------- alerts
    function renderAlerts() {
      const items = [];
      const s = store.state.status;
      const info = store.state.info;
      if (store.state.loadError) {
        items.push(
          notice({
            kind: 'danger',
            title: t('dash.load-error'),
            text: store.state.loadError === 'denied' ? t('err.denied') : t('dash.load-error-hint'),
            detail: store.state.loadError === 'denied' ? '' : store.state.loadError,
            actions: [button({ label: t('nav.advanced'), icon: 'code', onClick: () => ctx.go('advanced') })],
          }),
        );
      } else if (!store.state.fileExists) {
        items.push(notice({ kind: 'info', title: t('dash.no-file'), text: t('dash.no-file-hint', { path: store.state.settings.configPath }) }));
      }
      if (s && s.available && !s.loaded) {
        items.push(notice({ kind: 'warn', title: t('dash.not-found'), text: t('dash.not-found-hint', { unit: store.state.settings.unit }), actions: [button({ label: t('nav.settings'), icon: 'gear', onClick: () => ctx.go('settings') })] }));
      }
      if (info && !info.singbox.path) {
        items.push(notice({ kind: 'warn', title: t('dash.no-singbox'), text: t('dash.no-singbox-hint') }));
      }
      if (info && !info.helper) {
        items.push(notice({ kind: 'warn', title: t('err.no-helper'), text: t('dash.no-helper-hint') }));
      }
      mount(alerts, items);
    }

    // ---------------------------------------------------------- logs
    const logView = h('div', { class: 'logs', role: 'log', 'aria-live': 'off' });
    const logNote = h('div');

    async function loadLogs(prompt = false) {
      if (!store.state.status || !store.state.status.loaded) {
        mount(logView, h('div', { class: 'ln muted' }, t('logs.none')));
        return;
      }
      let r;
      try {
        r = await api.call('logs.get', { unit: store.state.settings.unit, lines: logLines, allowPrompt: prompt });
      } catch (e) {
        r = { ok: false, message: String((e && e.message) || e) };
      }
      logsDenied = !r.ok && r.reason === 'permission';
      if (logsDenied) {
        mount(logNote, notice({ kind: 'info', text: t('logs.denied'), actions: [button({ label: t('logs.allow'), icon: 'lock', size: 'sm', onClick: () => loadLogs(true) })] }));
        mount(logView, h('div', { class: 'ln muted' }, '—'));
        return;
      }
      clear(logNote);
      if (!r.ok) {
        if (r.reason) showFailure(r);
        return;
      }
      const stick = logView.scrollTop + logView.clientHeight >= logView.scrollHeight - 30;
      const lines = String(r.text || '').split('\n').filter((l) => l.trim() && !l.startsWith('-- '));
      mount(
        logView,
        lines.length
          ? lines.map((l) => {
              const p = parseLogLine(l);
              return h('div', { class: `ln lv-${p.level}` }, p.time ? h('span', { class: 'ts' }, p.time) : null, p.msg);
            })
          : h('div', { class: 'ln muted' }, t('logs.none')),
      );
      if (stick) logView.scrollTop = logView.scrollHeight;
    }

    function renderLogsCard() {
      const autoSwitch = toggle({ checked: autoLogs, onChange: (v) => (autoLogs = v), label: t('logs.auto') });
      const sel = select({
        options: [{ value: '50', label: '50' }, { value: '150', label: '150' }, { value: '400', label: '400' }, { value: '1000', label: '1000' }],
        value: String(logLines),
        onChange: (v) => {
          logLines = Number(v);
          sessionStorage.setItem('sbgui:loglines', v);
          loadLogs();
        },
      });
      sel.style.width = '90px';
      mount(
        logsBox,
        card(
          t('logs.title'),
          null,
          h('div', { class: 'col' }, logNote, logView),
          {
            actions: [
              h('span', { class: 'muted', style: { fontSize: '12px' } }, t('logs.auto')),
              autoSwitch,
              sel,
              button({ iconOnly: true, icon: 'refresh', variant: 'ghost', size: 'sm', label: t('common.refresh'), onClick: () => loadLogs() }),
              button({ iconOnly: true, icon: 'copy', variant: 'ghost', size: 'sm', label: t('common.copy'), onClick: async () => { const ok = await api.copyText(logView.innerText); toast(ok ? t('common.copied') : t('common.copy-failed'), ok ? 'ok' : 'error'); } }),
            ],
          },
        ),
      );
    }

    // ---------------------------------------------------------- wiring
    function renderAll() {
      renderAlerts();
      renderHero();
      renderTiles();
    }

    renderAll();
    renderLogsCard();
    loadLogs();

    const off = store.subscribe((kind) => {
      if (kind === 'status' || kind === 'busy' || kind === 'info') {
        renderAlerts();
        renderHero();
        renderTiles();
      } else if (kind === 'config' || kind === 'draft' || kind === 'check') {
        renderAlerts();
        renderTiles();
      }
    });

    ticker = setInterval(() => {
      const s = store.state.status;
      if (uptimeEl && s && s.active) uptimeEl.lastChild.textContent = formatDuration(Date.now() / 1000 - s.since);
    }, 1000);
    logTimer = setInterval(() => {
      if (autoLogs && !document.hidden && !logsDenied) loadLogs();
    }, 4000);

    return () => {
      off();
      clearInterval(ticker);
      clearInterval(logTimer);
    };
  },
};
