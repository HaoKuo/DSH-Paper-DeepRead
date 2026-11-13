/**
 * DSH-Paper-DeepRead — browser half (plain JavaScript, no build step).
 *
 * v1.7.0 — thin client. The browser half only adds the Paper Deepread sidebar
 * icon and one main-panel page: a full-height, same-origin iframe that renders
 * the host-served 文献精读库 at `/paper-deepread/index.html`. All management UI
 * — upload, report management and 手机访问 (mobile access) — lives in the
 * site's own management page (文献库 → 管理 → 手机访问), so the plugin no longer
 * injects tabs, toolbars or modals of its own.
 *
 * The host half (`src/*.js`) still owns the library route, the management API,
 * the model tools, the bundled-skill install/sync and the mobile-access runtime.
 * All CSS stays scoped under `.pdr`; the injected style tag is removed when the
 * plugin effect is disposed. No external assets.
 */

window.__ModuleLoader__.load({
  id: 'dsh-paper-deepread',
  factory: require => {
    const React = require('react')
    const inject = ['slots', 'connection', 'layout', 'locale']

    const LIBRARY_URL = '/paper-deepread/index.html'

    const css = `
.pdr{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111)}
.pdr *{box-sizing:border-box}
.pdr-frame{flex:1;display:block;width:100%;min-height:0;border:0;background:#fff}
`

    // ---- helpers -----------------------------------------------------------

    const h = React.createElement

    function Icon({ size = 20 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round',
        strokeLinejoin: 'round', 'aria-hidden': true, focusable: false,
      },
        h('path', { d: 'M4.5 4.2A2.2 2.2 0 0 1 6.7 2h7.1a2.2 2.2 0 0 1 2.2 2.2v15.6a2.2 2.2 0 0 1-2.2 2.2H6.7a2.2 2.2 0 0 1-2.2-2.2V4.2Z' }),
        h('path', { d: 'M7.6 7.1h4.6M7.6 10.4h4.6M7.6 13.7h2.8' }),
        h('circle', { cx: 17.2, cy: 10.4, r: 3.1 }),
        h('path', { d: 'm19.5 12.7 2.3 2.3' }))
    }

    // ---- page --------------------------------------------------------------

    /**
     * The whole panel: the host-served library page in a full-height iframe.
     * Every action (upload, report management, 手机访问) lives inside that page.
     */
    function PaperDeepreadPage() {
      return h('section', { className: 'pdr', 'aria-label': 'Paper Deepread 文献精读库' },
        h('iframe', {
          className: 'pdr-frame',
          src: LIBRARY_URL,
          title: '文献精读库',
          loading: 'eager',
          referrerPolicy: 'same-origin',
          allow: 'fullscreen',
        }))
    }

    function apply(ctx) {
      const style = document.createElement('style')
      style.dataset.pluginCss = 'dsh-paper-deepread'
      style.textContent = css
      document.head.appendChild(style)
      ctx.effect(() => () => { style.remove() }, 'DSH-Paper-DeepRead: styles')

      ctx.slots.inject('main', function* () {
        yield ctx.slots.register({
          name: 'main',
          key: 'paper-deepread',
          children: {
            'paper-deepread.page': { kind: 'single', scope: 'root' },
          },
        }, ({ renderSlot }) => renderSlot('paper-deepread.page', {}))
        yield ctx.slots.register({ name: 'paper-deepread.page' }, PaperDeepreadPage)
      })

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'paper-deepread',
        order: -9,
        label: 'Paper Deepread',
      }, Icon))
    }

    return { inject, apply }
  },
})
