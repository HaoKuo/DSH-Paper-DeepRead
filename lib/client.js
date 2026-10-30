/**
 * DSH-Paper-DeepRead — browser half (plain ES5-compatible source, no build step).
 *
 * Registers a sidebar panel icon and a main-panel page that renders the bundled
 * 文献精读库 (Paper Deepread library) in a same-origin iframe. The iframe is
 * served by the host half at /paper-deepread/index.html, so the page needs no
 * additional RPC or sandbox anywhere.
 *
 * The module is loaded by the Harness Web module loader; React comes from the
 * browser module table. Keep this factory free of side effects: the style tag
 * is added in `apply` and removed when the plugin effect is disposed.
 */

window.__ModuleLoader__.load({
  id: 'dsh-paper-deepread',
  factory: require => {
    const React = require('react')
    const inject = ['slots', 'connection', 'layout', 'locale']

    const PAGE_URL = '/paper-deepread/index.html'

    // Component CSS. Everything is scoped under `.pdr` so the page never
    // restyles host chrome or the conversation panel.
    const css = `
.pdr{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);font:14px/1.5 var(--dsw-font-family,system-ui,-apple-system,"Segoe UI",sans-serif)}
.pdr *{box-sizing:border-box}
.pdr-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 16px;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));background:var(--dsw-alias-bg-base,#fff)}
.pdr-brand{display:flex;align-items:center;gap:10px;min-width:0}
.pdr-mark{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:var(--dsw-alias-brand-primary,#2456d6);color:#fff}
.pdr-titles{min-width:0}
.pdr-titles h1{margin:0;font-size:15px;font-weight:600;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pdr-titles p{margin:0;font-size:11px;line-height:1.3;color:var(--dsw-alias-label-secondary,#666);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pdr-actions{flex:none;display:flex;align-items:center;gap:8px}
.pdr-btn{appearance:none;display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.16));border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:1.4;text-decoration:none;cursor:pointer;white-space:nowrap}
.pdr-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.pdr-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2456d6);outline-offset:2px}
.pdr-frame{flex:1;display:block;width:100%;min-height:0;border:0;background:#fff}
@media (max-width:560px){.pdr-titles p{display:none}.pdr-actions .pdr-btn-label{display:none}}
`

    /** Original sidebar glyph: a document page plus a magnifier. */
    function PaperDeepreadIcon({ size = 20 }) {
      return React.createElement('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round',
        strokeLinejoin: 'round', 'aria-hidden': true, focusable: false,
      },
        React.createElement('path', { d: 'M4.5 4.2A2.2 2.2 0 0 1 6.7 2h7.1a2.2 2.2 0 0 1 2.2 2.2v15.6a2.2 2.2 0 0 1-2.2 2.2H6.7a2.2 2.2 0 0 1-2.2-2.2V4.2Z' }),
        React.createElement('path', { d: 'M7.6 7.1h4.6M7.6 10.4h4.6M7.6 13.7h2.8' }),
        React.createElement('circle', { cx: 17.2, cy: 10.4, r: 3.1 }),
        React.createElement('path', { d: 'm19.5 12.7 2.3 2.3' }),
      )
    }

    /** Full-height page: a compact toolbar above the bundled library iframe. */
    function PaperDeepreadPage() {
      const [reloadKey, setReloadKey] = React.useState(0)
      return React.createElement('section', { className: 'pdr', 'aria-label': 'Paper Deepread 文献精读库' },
        React.createElement('header', { className: 'pdr-head' },
          React.createElement('div', { className: 'pdr-brand' },
            React.createElement('span', { className: 'pdr-mark', 'aria-hidden': true },
              PaperDeepreadIcon({ size: 18 })),
            React.createElement('div', { className: 'pdr-titles' },
              React.createElement('h1', null, '文献精读库'),
              React.createElement('p', null, 'Paper Deepread · 交互式论文精读报告'))),
          React.createElement('div', { className: 'pdr-actions' },
            React.createElement('a', {
              className: 'pdr-btn', href: PAGE_URL, target: '_blank', rel: 'noopener noreferrer',
            }, '在新标签页打开'),
            React.createElement('button', {
              className: 'pdr-btn', type: 'button',
              onClick: () => setReloadKey(key => key + 1),
            }, '刷新'))),
        React.createElement('iframe', {
          key: reloadKey,
          className: 'pdr-frame',
          src: PAGE_URL,
          title: '文献精读库',
          loading: 'eager',
          referrerPolicy: 'same-origin',
          allow: 'fullscreen',
        }))
    }

    function apply(ctx) {
      // Styles are added with the plugin and removed on dispose.
      const style = document.createElement('style')
      style.dataset.pluginCss = 'dsh-paper-deepread'
      style.textContent = css
      document.head.appendChild(style)
      ctx.effect(() => () => { style.remove() }, 'DSH-Paper-DeepRead: styles')

      // Main-panel page, registered in the same two-step shape as the built-in
      // conversation panel: a keyed `main` entry, then its child page.
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

      // Sidebar entry; panel id must equal the `main` key so selecting it
      // switches the main panel to the page above.
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'paper-deepread',
        order: -9,
        label: 'Paper Deepread',
      }, PaperDeepreadIcon))
    }

    return { inject, apply }
  },
})
