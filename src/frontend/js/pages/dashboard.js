// Dashboard: one big power button and the facts about the service.

import { h, icon, button, notice, pill, toggle, mount, toast } from '../dom.js';
import { t } from '../i18n.js';
import * as store from '../store.js';
import { runService, showFailure } from '../ui/actions.js';
import { formatDuration, formatBytes } from '../util.js';
import { inbounds, outbounds, getRules, dnsServers, ruleSets } from '../config.js';

export const dashboard = {
  id: 'dashboard',
  icon: 'home',
  render(view, ctx) {
    const hero = h('div');
    const tiles = h('div', { class: 'grid cols-3' });
    const alerts = h('div', { class: 'col' });
    let uptimeEl = null;
    let ticker = null;

    mount(view, h('div', { class: 'view-inner' }, alerts, hero, tiles));

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
        actions.append(button({ label: t('dash.view-logs'), icon: 'terminal', variant: s.state === 'failed' ? 'primary' : 'ghost', onClick: () => ctx.go('logs') }));
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
        h('div', { class: 'row' }, h('div', { class: 'v grow', style: { fontSize: '15px' } }, s && s.enabled ? t('dash.autostart-on') : t('dash.autostart-off')), toggle({ label: t('dash.autostart'), checked: !!(s && s.enabled), disabled: !s || !s.loaded || !!store.state.busy, onChange: async (on, el) => { el.disabled = true; await runService(on ? 'enable' : 'disable'); } })),
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

    // ---------------------------------------------------------- wiring
    function renderAll() {
      renderAlerts();
      renderHero();
      renderTiles();
    }

    renderAll();

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

    return () => {
      off();
      clearInterval(ticker);
    };
  },
};
