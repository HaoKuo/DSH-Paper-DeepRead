/**
 * DSH-Paper-DeepRead — browser half (plain JavaScript, no build step).
 *
 * v1.1.0 adds two panels beside the library:
 *   - 上传 (Upload): drag & drop PDFs into the managed inbox, watch progress,
 *     delete pending uploads, and copy a prefilled chat instruction. The plugin
 *     never calls a model: an agent in a session runs the deep-read tools.
 *   - 报告管理 (Reports): list reports, open report/raw PDF, hide/unhide,
 *     delete one report directory, and rebuild the library index in one click.
 *
 * The library tab renders the host-served site at /paper-deepread/index.html in
 * a same-origin iframe. All CSS stays scoped under `.pdr`; the injected style
 * tag is removed when the plugin effect is disposed. No external assets.
 */

window.__ModuleLoader__.load({
  id: 'dsh-paper-deepread',
  factory: require => {
    const React = require('react')
    const inject = ['slots', 'connection', 'layout', 'locale']

    const LIBRARY_URL = '/paper-deepread/index.html'
    const API = '/paper-deepread/api'

    const DEFAULT_PROMPT = [
      '请精读我上传的待处理文献：',
      '1) 先调用 paper_deepread_uploads（action: "list"）查看上传队列；',
      '2) 对每篇待处理文献调用 paper_deepread_uploads（action: "ingest", id: <上传ID>）完成 PDF 摄取；',
      '3) 按 paper-deepread-html 技能逐图核对裁切、撰写 content.html 与 meta.json；',
      '4) 调用 paper_deepread_reports（action: "build", id: <上传ID>）生成报告并重建索引。',
    ].join('\n')

    const css = `
.pdr{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);font:14px/1.5 var(--dsw-font-family,system-ui,-apple-system,"Segoe UI",sans-serif)}
.pdr *{box-sizing:border-box}
.pdr-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));background:var(--dsw-alias-bg-base,#fff)}
.pdr-brand{display:flex;align-items:center;gap:10px;min-width:0}
.pdr-mark{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:var(--dsw-alias-brand-primary,#2456d6);color:#fff}
.pdr-titles{min-width:0}
.pdr-titles h1{margin:0;font-size:15px;font-weight:600;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pdr-titles p{margin:0;font-size:11px;line-height:1.3;color:var(--dsw-alias-label-secondary,#666);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pdr-actions{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.pdr-tabs{flex:none;display:flex;gap:4px;padding:6px 14px;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));background:var(--dsw-alias-bg-base,#fff);overflow-x:auto}
.pdr-tab{appearance:none;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#666);font:inherit;font-size:13px;line-height:1.4;padding:6px 12px;cursor:pointer;white-space:nowrap}
.pdr-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.pdr-tab[aria-selected=true]{color:var(--dsw-alias-label-primary,#111);background:var(--dsw-alias-interactive-bg-active,rgba(36,86,214,.12));font-weight:600}
.pdr-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2456d6);outline-offset:2px}
.pdr-badge{display:inline-block;min-width:18px;margin-left:5px;padding:0 5px;border-radius:9px;background:var(--dsw-alias-interactive-bg-active,#e6edff);font-size:11px;line-height:18px;text-align:center}
.pdr-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.pdr-body[hidden]{display:none}
.pdr-scroll{flex:1;min-height:0;overflow:auto;padding:16px 18px 24px}
.pdr-frame{flex:1;display:block;width:100%;min-height:0;border:0;background:#fff}
.pdr-btn{appearance:none;display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.16));border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:1.4;text-decoration:none;cursor:pointer;white-space:nowrap}
.pdr-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.pdr-btn:disabled{opacity:.5;cursor:not-allowed}
.pdr-btn.primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill,#2456d6);color:var(--dsw-alias-label-primary-inverted,#fff)}
.pdr-btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#1d47b8)}
.pdr-btn.danger{color:var(--dsw-alias-state-error-primary,#c62828)}
.pdr-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2456d6);outline-offset:2px}
.pdr-section{max-width:960px;margin:0 auto}
.pdr-card{border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));border-radius:10px;padding:14px 16px;background:var(--dsw-alias-bg-base,#fff);margin-bottom:14px}
.pdr-card h2{margin:0 0 4px;font-size:14px;font-weight:650}
.pdr-card p{margin:4px 0;color:var(--dsw-alias-label-secondary,#666);font-size:12.5px;line-height:1.6}
.pdr-mono{font-family:var(--dsw-font-family-mono,ui-monospace,Menlo,monospace);font-size:11.5px;overflow-wrap:anywhere}
.pdr-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 14px;padding:0;list-style:none;counter-reset:step}
.pdr-steps li{position:relative;border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));border-radius:9px;padding:10px 12px 10px 38px;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary,#666)}
.pdr-steps li::before{counter-increment:step;content:counter(step);position:absolute;left:10px;top:9px;width:20px;height:20px;border-radius:50%;background:var(--dsw-alias-interactive-bg-active,#e6edff);color:var(--dsw-alias-brand-primary,#2456d6);font-size:11px;font-weight:700;display:grid;place-items:center}
.pdr-drop{border:1.5px dashed var(--dsw-alias-border-l3,rgba(0,0,0,.22));border-radius:10px;padding:22px 16px;text-align:center;cursor:pointer;transition:background .15s,border-color .15s;background:transparent}
.pdr-drop:hover,.pdr-drop.over{border-color:var(--dsw-alias-brand-primary,#2456d6);background:var(--dsw-alias-interactive-bg-active,rgba(36,86,214,.08))}
.pdr-drop strong{display:block;font-size:13.5px;margin-bottom:3px}
.pdr-drop span{font-size:12px;color:var(--dsw-alias-label-secondary,#666)}
.pdr-drop input{display:none}
.pdr-progress{height:6px;border-radius:3px;background:var(--dsw-alias-border-l3,rgba(0,0,0,.1));overflow:hidden;margin-top:10px}
.pdr-progress i{display:block;height:100%;background:var(--dsw-alias-brand-primary,#2456d6);transition:width .15s}
.pdr-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.08))}
.pdr-row:first-child{border-top:0}
.pdr-row-main{min-width:0;flex:1}
.pdr-row-title{font-size:13px;font-weight:550;overflow-wrap:anywhere}
.pdr-row-meta{margin-top:3px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#666);display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pdr-row-actions{flex:none;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.pdr-badge-status{display:inline-block;padding:1px 7px;border-radius:9px;font-size:11px;line-height:17px;background:var(--dsw-alias-interactive-bg-active,#e6edff);color:var(--dsw-alias-label-primary,#111);white-space:nowrap}
.pdr-badge-status.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#2e7d32) 16%,transparent);color:var(--dsw-alias-state-success-primary,#2e7d32)}
.pdr-badge-status.warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#a15c00) 16%,transparent);color:var(--dsw-alias-state-warn-primary,#a15c00)}
.pdr-badge-status.bad{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#c62828) 14%,transparent);color:var(--dsw-alias-state-error-primary,#c62828)}
.pdr-prompt{width:100%;min-height:104px;resize:vertical;padding:9px 11px;border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.16));border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:inherit;font:12px/1.7 var(--dsw-font-family-mono,ui-monospace,Menlo,monospace)}
.pdr-prompt:focus{outline:2px solid var(--dsw-alias-brand-primary,#2456d6);outline-offset:1px}
.pdr-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 12px}
.pdr-summary{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.pdr-metric{flex:1 1 150px;min-width:130px;border:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));border-radius:10px;padding:10px 12px}
.pdr-metric b{display:block;font-size:20px;line-height:1.2}
.pdr-metric span{font-size:11.5px;color:var(--dsw-alias-label-secondary,#666)}
.pdr-table{width:100%;border-collapse:collapse;font-size:12.5px}
.pdr-table th{text-align:left;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#666);padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));white-space:nowrap}
.pdr-table td{padding:9px 8px;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.07));vertical-align:top}
.pdr-table tr:last-child td{border-bottom:0}
.pdr-table .pdr-title{font-weight:550;overflow-wrap:anywhere}
.pdr-table .pdr-sub{display:block;font-size:11px;color:var(--dsw-alias-label-secondary,#666);margin-top:2px;overflow-wrap:anywhere}
.pdr-table td.nowrap{white-space:nowrap}
.pdr-cell-actions{display:flex;gap:5px;flex-wrap:wrap}
.pdr-hidden{opacity:.6}
.pdr-empty{padding:26px 12px;text-align:center;color:var(--dsw-alias-label-secondary,#666);font-size:12.5px}
.pdr-error{color:var(--dsw-alias-state-error-primary,#c62828);font-size:12.5px;margin:8px 0;overflow-wrap:anywhere;white-space:pre-wrap}
.pdr-notice{color:var(--dsw-alias-label-primary,#111);font-size:12.5px;margin:8px 0;overflow-wrap:anywhere;white-space:pre-wrap}
.pdr-log{max-height:180px;overflow:auto;margin:8px 0 0;padding:9px 11px;border-radius:7px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));font:11px/1.55 var(--dsw-font-family-mono,ui-monospace,Menlo,monospace);white-space:pre-wrap;overflow-wrap:anywhere}
.pdr-note{font-size:11.5px;color:var(--dsw-alias-label-secondary,#666);margin-top:10px;line-height:1.6}
.pdr-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:720px){.pdr-steps{grid-template-columns:1fr}.pdr-table thead{display:none}.pdr-table tr{display:block;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));padding:8px 0}.pdr-table td{display:block;border:0;padding:2px 4px}.pdr-cell-actions{margin-top:6px}.pdr-titles p{display:none}.pdr-scroll{padding:12px}}
@media (max-width:560px){.pdr-actions .pdr-btn-label{display:none}.pdr-head{padding:8px 12px}.pdr-tabs{padding:4px 8px}}
`

    // ---- helpers -----------------------------------------------------------

    const h = React.createElement

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB']
      let value = bytes
      let index = 0
      while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1 }
      return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
    }

    function formatTime(iso) {
      const time = Date.parse(iso || '')
      if (!Number.isFinite(time)) return ''
      const date = new Date(time)
      const pad = value => String(value).padStart(2, '0')
      return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    const STATUS_META = {
      uploaded: { label: '待精读', tone: 'warn' },
      ingested: { label: '已摄取 · 待成稿', tone: 'warn' },
      reported: { label: '已成稿', tone: 'ok' },
      failed: { label: '失败', tone: 'bad' },
    }

    async function api(path, options = {}) {
      const response = await fetch(`${API}${path}`, { cache: 'no-store', ...options })
      let body
      try { body = await response.json() } catch { body = null }
      if (!response.ok || body?.ok === false) {
        throw new Error(body?.error?.message || `请求失败（HTTP ${response.status}）`)
      }
      return body
    }

    function postJson(path, payload = {}) {
      return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    }

    /** Shared managed-library snapshot with periodic refresh. */
    function useServerState() {
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState('')
      const mounted = React.useRef(true)
      const refresh = React.useCallback(async () => {
        try {
          const next = await api('/state')
          if (mounted.current) { setState(next); setError('') }
          return next
        } catch (cause) {
          if (mounted.current) setError(cause.message)
          throw cause
        }
      }, [])
      React.useEffect(() => {
        mounted.current = true
        void refresh().catch(() => {})
        const timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          void refresh().catch(() => {})
        }, 6000)
        return () => { mounted.current = false; clearInterval(timer) }
      }, [refresh])
      return { state, error, refresh }
    }

    /** Copy text using the clipboard API with a textarea fallback. */
    async function copyText(text) {
      try {
        if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
      } catch { /* fall through */ }
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        area.remove()
        return ok
      } catch { return false }
    }

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

    // ---- tabs --------------------------------------------------------------

    function LibraryTab({ reloadKey, onReload }) {
      return h('div', { className: 'pdr-body' },
        h('div', { className: 'pdr-toolbar', style: { padding: '10px 16px 0', margin: 0 } },
          h('a', { className: 'pdr-btn', href: LIBRARY_URL, target: '_blank', rel: 'noopener noreferrer' }, '在新标签页打开'),
          h('button', { className: 'pdr-btn', type: 'button', onClick: onReload }, '刷新')),
        h('iframe', {
          key: reloadKey,
          className: 'pdr-frame',
          src: LIBRARY_URL,
          title: '文献精读库',
          loading: 'eager',
          referrerPolicy: 'same-origin',
          allow: 'fullscreen',
        }))
    }

    function UploadTab({ state, refresh }) {
      const [dragOver, setDragOver] = React.useState(false)
      const [uploading, setUploading] = React.useState(null)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [copied, setCopied] = React.useState('')
      const [promptDraft, setPromptDraft] = React.useState(null)
      const inputRef = React.useRef(null)
      const mounted = React.useRef(true)
      React.useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

      const uploads = state?.uploads || []
      const pending = uploads.filter(entry => ['uploaded', 'ingested', 'failed'].includes(entry.status))
      const pendingKey = pending.map(entry => entry.id).join(',')
      const defaultPrompt = React.useMemo(() => {
        if (pending.length === 0) return DEFAULT_PROMPT
        const names = pending.slice(0, 8).map(entry => `${entry.name}（id: ${entry.id}）`).join('；')
        return [
          `请精读我上传的待处理文献：${names}${pending.length > 8 ? ` 等 ${pending.length} 篇` : ''}。`,
          '先用 paper_deepread_uploads（action: "list"）确认队列，再逐篇调用 paper_deepread_uploads（action: "ingest", id: <上传ID>），',
          '按 paper-deepread-html 技能核对裁切并撰写 content.html 与 meta.json，',
          '最后调用 paper_deepread_reports（action: "build", id: <上传ID>）生成报告并重建索引。',
        ].join('')
      }, [pendingKey, pending.length]) // eslint-disable-line react-hooks/exhaustive-deps
      const prompt = promptDraft ?? defaultPrompt

      function uploadOne(file, onProgress) {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('POST', `${API}/upload`)
          xhr.setRequestHeader('content-type', 'application/pdf')
          xhr.setRequestHeader('x-filename', encodeURIComponent(file.name))
          xhr.upload.onprogress = event => {
            if (event.lengthComputable) onProgress(event.loaded / event.total)
          }
          xhr.onload = () => {
            let body = null
            try { body = JSON.parse(xhr.responseText) } catch { /* ignore */ }
            if (xhr.status >= 200 && xhr.status < 300 && body?.ok) resolve(body)
            else reject(new Error(body?.error?.message || `上传失败（HTTP ${xhr.status}）`))
          }
          xhr.onerror = () => reject(new Error('网络错误，上传失败'))
          xhr.send(file)
        })
      }

      async function uploadFiles(selection) {
        const all = Array.from(selection || [])
        const files = all.filter(file => /\.pdf$/iu.test(file.name) || file.type === 'application/pdf')
        setError('')
        setNotice('')
        if (all.length > 0 && files.length === 0) { setError('只能上传 PDF 文件'); return }
        if (files.length < all.length) setNotice(`已忽略 ${all.length - files.length} 个非 PDF 文件`)
        for (const [index, file] of files.entries()) {
          if (!mounted.current) return
          setUploading({ index: index + 1, total: files.length, name: file.name, percent: 0 })
          try {
            await uploadOne(file, fraction => {
              if (mounted.current) setUploading(current => current ? { ...current, percent: Math.round(fraction * 100) } : current)
            })
          } catch (cause) {
            setError(`${file.name}：${cause.message}`)
          }
          await refresh().catch(() => {})
        }
        if (mounted.current) {
          setUploading(null)
          setNotice(files.length > 0 ? `已上传 ${files.length} 篇 PDF，下一步请把下方指令发给对话中的 Agent。` : '')
        }
      }

      async function removeUpload(upload) {
        if (!window.confirm(`删除待处理文献「${upload.name}」？原始 PDF 与摄取产物会一并删除。`)) return
        setError('')
        setNotice('')
        try {
          await postJson('/uploads/delete', { id: upload.id })
          setNotice(`已删除 ${upload.name}`)
          await refresh()
        } catch (cause) { setError(cause.message) }
      }

      async function copyPrompt() {
        const ok = await copyText(prompt)
        setCopied(ok ? '已复制，粘贴到对话中发送给 Agent' : '复制失败，请手动选中文本复制')
        setTimeout(() => { if (mounted.current) setCopied('') }, 4000)
      }

      const steps = h('ol', { className: 'pdr-steps' },
        h('li', null, '上传 PDF 到插件管理的待处理队列（不离开本页）。'),
        h('li', null, '把下方指令复制到对话里发给 Agent；插件不会自己调用模型，精读由 Agent 用工具完成。'),
        h('li', null, '报告生成后在「报告管理」打开、隐藏或删除，并可一键重建索引。'))

      const dropzone = h('div', {
        className: 'pdr-drop' + (dragOver ? ' over' : ''),
        role: 'button',
        tabIndex: 0,
        'aria-label': '选择或拖放 PDF 文件上传',
        onClick: () => { if (!uploading) inputRef.current?.click() },
        onKeyDown: event => { if ((event.key === 'Enter' || event.key === ' ') && !uploading) inputRef.current?.click() },
        onDragOver: event => { event.preventDefault(); setDragOver(true) },
        onDragLeave: () => setDragOver(false),
        onDrop: event => {
          event.preventDefault()
          setDragOver(false)
          if (!uploading) void uploadFiles(event.dataTransfer?.files)
        },
      },
        h('strong', null, uploading ? `正在上传 ${uploading.index}/${uploading.total}` : '拖放 PDF 到这里，或点击选择文件'),
        h('span', null, uploading ? `${uploading.name} · ${uploading.percent}%` : '支持多选；上传后可随时删除'),
        h('input', {
          ref: inputRef, type: 'file', accept: 'application/pdf,.pdf', multiple: true,
          onChange: event => { const files = event.target.files; event.target.value = ''; void uploadFiles(files) },
        }))

      const uploadCard = h('div', { className: 'pdr-card' },
        h('h2', null, '上传论文 PDF'),
        h('p', null, `仅接受 PDF，单篇不超过 ${formatBytes(state?.limits?.maxUploadBytes || 0)}；保存在 ${state?.dataDir || '$DSH_HOME/paper-deepread'}。`),
        dropzone,
        uploading && h('div', { className: 'pdr-progress', role: 'progressbar', 'aria-valuenow': uploading.percent, 'aria-valuemin': 0, 'aria-valuemax': 100 },
          h('i', { style: { width: `${uploading.percent}%` } })),
        error && h('p', { className: 'pdr-error', role: 'alert' }, error),
        notice && h('p', { className: 'pdr-notice' }, notice))

      const rows = uploads.map(upload => {
        const meta = STATUS_META[upload.status] || { label: upload.status, tone: '' }
        return h('div', { className: 'pdr-row', key: upload.id },
          h('div', { className: 'pdr-row-main' },
            h('div', { className: 'pdr-row-title' }, upload.name),
            h('div', { className: 'pdr-row-meta' },
              h('span', { className: `pdr-badge-status ${meta.tone}` }, meta.label),
              h('span', null, formatBytes(upload.bytes)),
              h('span', null, formatTime(upload.createdAt)),
              h('span', { className: 'pdr-mono', title: upload.pdfPath || '' }, `id: ${upload.id}`)),
            upload.error && h('div', { className: 'pdr-error' }, upload.error)),
          h('div', { className: 'pdr-row-actions' },
            upload.status === 'reported' && h('a', { className: 'pdr-btn', href: LIBRARY_URL, target: '_blank', rel: 'noopener noreferrer' }, '查看报告'),
            h('button', { className: 'pdr-btn danger', type: 'button', onClick: () => void removeUpload(upload) }, '删除')))
      })

      const queueCard = h('div', { className: 'pdr-card' },
        h('h2', null, `待处理队列（${pending.length}）`),
        uploads.length === 0 ? h('p', { className: 'pdr-empty' }, '还没有上传记录。先拖入一篇 PDF。') : rows)

      const handoffCard = h('div', { className: 'pdr-card' },
        h('h2', null, '交给 Agent 精读'),
        h('p', null, '插件本身不调用模型。复制下面的指令，粘贴到任意对话发送；Agent 会调用 paper_deepread_uploads / paper_deepread_reports 完成摄取与成稿。'),
        h('textarea', {
          className: 'pdr-prompt',
          value: prompt,
          'aria-label': '给 Agent 的精读指令',
          onChange: event => setPromptDraft(event.target.value),
        }),
        h('div', { className: 'pdr-toolbar', style: { marginTop: 10 } },
          h('button', { className: 'pdr-btn primary', type: 'button', onClick: () => void copyPrompt() }, '复制指令'),
          h('button', { className: 'pdr-btn', type: 'button', onClick: () => setPromptDraft(null) }, '恢复默认'),
          copied && h('span', { className: 'pdr-note' }, copied)),
        h('p', { className: 'pdr-note' }, '提示：先在对话里确认 Agent 已加载 paper-deepread-html 技能；摄取大 PDF 需要几分钟，期间可以离开本页。'))

      const content = h('div', { className: 'pdr-section' }, steps, uploadCard, queueCard, handoffCard)
      return h('div', { className: 'pdr-body' }, h('div', { className: 'pdr-scroll' }, content))
    }

    function ManageTab({ state, refresh }) {
      const [busy, setBusy] = React.useState('')
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [log, setLog] = React.useState('')
      const reports = state?.reports || []
      const visible = reports.filter(report => !report.hidden).length

      async function run(label, work) {
        setBusy(label)
        setError('')
        setNotice('')
        setLog('')
        try {
          const result = await work()
          if (result?.log) setLog(String(result.log).trim().slice(-4000))
          if (result?.rebuild && result.rebuild.ok === false) setError(result.rebuild.error || '索引重建失败')
          await refresh()
          return result
        } catch (cause) {
          setError(cause.message)
        } finally {
          setBusy('')
        }
      }

      function rebuild() {
        return run('rebuild', async () => {
          const result = await postJson('/reports/rebuild', {})
          setNotice(`索引已重建：${result.stats?.n ?? '?'} 篇 · 版本 ${result.stats?.version ?? '—'}`)
          return result
        })
      }

      function toggle(report) {
        return run(report.dir, async () => {
          const result = await postJson('/reports/visibility', { dir: report.dir, hidden: !report.hidden })
          setNotice(result.hidden ? `已隐藏：${report.title}` : `已显示：${report.title}`)
          return result
        })
      }

      function remove(report) {
        if (!window.confirm(`删除报告「${report.title}」？\n只会删除该论文目录：${report.dir}\n此操作不可撤销。`)) return
        return run(report.dir, async () => {
          const result = await postJson('/reports/delete', { dir: report.dir })
          setNotice(`已删除报告目录：${report.dir}`)
          return result
        })
      }

      const summary = h('div', { className: 'pdr-summary' },
        h('div', { className: 'pdr-metric' }, h('b', null, String(reports.length)), h('span', null, `报告 · 可见 ${visible}`)),
        h('div', { className: 'pdr-metric' }, h('b', null, String(state?.library?.count ?? '—')), h('span', null, '索引内论文')),
        h('div', { className: 'pdr-metric' }, h('b', null, state?.library?.version || '—'), h('span', null, '书库版本')))

      const toolbarCard = h('div', { className: 'pdr-card' },
        h('div', { className: 'pdr-toolbar', style: { margin: 0 } },
          h('button', { className: 'pdr-btn', type: 'button', disabled: Boolean(busy), onClick: () => void refresh().catch(() => {}) }, '刷新'),
          h('button', { className: 'pdr-btn primary', type: 'button', disabled: Boolean(busy), onClick: () => void rebuild() }, busy === 'rebuild' ? '重建中…' : '重建索引'),
          busy && busy !== 'rebuild' && h('span', { className: 'pdr-note' }, '处理中…')),
        h('p', { className: 'pdr-mono', title: state?.library?.root || '' }, `书库根目录：${state?.library?.root || '—'}`),
        h('p', null, '「重建索引」是确定性操作，不需要模型：它用 build_library.py 重新生成 index.html / index.md。'),
        error && h('p', { className: 'pdr-error', role: 'alert' }, error),
        notice && h('p', { className: 'pdr-notice' }, notice),
        log && h('details', null, h('summary', null, '查看重建日志'), h('pre', { className: 'pdr-log' }, log)))

      const rows = reports.map(report => h('tr', { key: report.dir, className: report.hidden ? 'pdr-hidden' : '' },
        h('td', null,
          h('span', { className: 'pdr-title' }, report.title),
          h('span', { className: 'pdr-sub' }, report.dir + (report.hidden ? ' · 已隐藏' : ''))),
        h('td', { className: 'nowrap' }, report.year || '—'),
        h('td', null, report.journal || '—'),
        h('td', { className: 'nowrap' }, formatBytes(report.sizeBytes)),
        h('td', null, h('div', { className: 'pdr-cell-actions' },
          h('a', { className: 'pdr-btn', href: report.reportUrl, target: '_blank', rel: 'noopener noreferrer' }, '打开'),
          report.rawUrl && h('a', { className: 'pdr-btn', href: report.rawUrl, target: '_blank', rel: 'noopener noreferrer' }, '原文'),
          h('button', { className: 'pdr-btn', type: 'button', disabled: Boolean(busy), onClick: () => void toggle(report) }, report.hidden ? '显示' : '隐藏'),
          h('button', { className: 'pdr-btn danger', type: 'button', disabled: Boolean(busy), onClick: () => void remove(report) }, '删除')))))

      const table = h('table', { className: 'pdr-table' },
        h('thead', null, h('tr', null,
          h('th', null, '论文'), h('th', null, '年份'), h('th', null, '期刊'), h('th', null, '大小'), h('th', null, '操作'))),
        h('tbody', null, rows))

      const listCard = h('div', { className: 'pdr-card' },
        h('h2', null, `报告列表（${reports.length}）`),
        reports.length === 0
          ? h('p', { className: 'pdr-empty' }, '还没有报告。上传论文并交给 Agent 精读后，报告会出现在这里。')
          : table,
        h('p', { className: 'pdr-note' }, '删除报告只移除该论文目录与 RAW PDF，不影响其他论文；索引会自动重建。隐藏会把该论文从书库页面过滤，但目录仍保留。'))

      const content = h('div', { className: 'pdr-section' }, summary, toolbarCard, listCard)
      return h('div', { className: 'pdr-body' }, h('div', { className: 'pdr-scroll' }, content))
    }

    // ---- page --------------------------------------------------------------

    function PaperDeepreadPage() {
      const [tab, setTab] = React.useState('library')
      const [reloadKey, setReloadKey] = React.useState(0)
      const { state, error, refresh } = useServerState()
      const pendingCount = (state?.uploads || []).filter(entry => ['uploaded', 'ingested', 'failed'].includes(entry.status)).length
      const tabList = [
        { id: 'library', label: '文献库' },
        { id: 'upload', label: '上传', count: pendingCount },
        { id: 'manage', label: '报告管理', count: state?.reports?.length ?? 0 },
      ]
      return h('section', { className: 'pdr', 'aria-label': 'Paper Deepread 文献精读库' },
        h('header', { className: 'pdr-head' },
          h('div', { className: 'pdr-brand' },
            h('span', { className: 'pdr-mark', 'aria-hidden': true }, Icon({ size: 18 })),
            h('div', { className: 'pdr-titles' },
              h('h1', null, '文献精读库'),
              h('p', null, 'Paper Deepread · 上传、精读与报告管理'))),
          h('div', { className: 'pdr-actions' },
            h('span', { className: 'pdr-note', title: state?.library?.root || '' },
              state?.library ? `${state.library.count} 篇 · v${state.library.version || '—'}` : '加载中…'))),
        h('nav', { className: 'pdr-tabs', role: 'tablist', 'aria-label': 'Paper Deepread 视图' },
          tabList.map(entry => h('button', {
            key: entry.id, type: 'button', role: 'tab', className: 'pdr-tab',
            'aria-selected': tab === entry.id,
            onClick: () => setTab(entry.id),
          }, entry.label, entry.count ? h('span', { className: 'pdr-badge' }, String(entry.count)) : null))),
        error && h('p', { className: 'pdr-error', style: { padding: '8px 16px 0' }, role: 'alert' }, error),
        h('div', { className: 'pdr-body', hidden: tab !== 'library' },
          h(LibraryTab, { reloadKey, onReload: () => setReloadKey(key => key + 1) })),
        h('div', { className: 'pdr-body', hidden: tab !== 'upload' },
          h(UploadTab, { state, refresh })),
        h('div', { className: 'pdr-body', hidden: tab !== 'manage' },
          h(ManageTab, { state, refresh })))
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
