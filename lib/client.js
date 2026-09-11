/**
 * dsh-relay-toolkit —— 浏览器半侧。
 *
 * 在设置页注册一个「中转站工具」区块：列出 llm-pi-ai 的每条中转站路由，
 * 显示思考等级声明的缺失情况，并提供两个动作 —— 同步模型、补全思考等级。
 *
 * 数据全部来自宿主半侧挂在 `/api/relay-toolkit` 下的只读/写入端点，
 * 这里不做任何本地推断：界面上显示的“建议”就是宿主将要写入的内容。
 *
 * 手写的 `__ModuleLoader__` bundle（不经构建）：只 require 平台播种表里的
 * react / react/jsx-runtime，因此不需要 dsh.client.external 声明。
 */
window.__ModuleLoader__.load({
  id: 'dsh-relay-toolkit',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const BASE_PATH = '/api/relay-toolkit'

    /** 调宿主端点；业务失败以 ok:false 返回，这里统一抛出可读消息。 */
    async function callApi (endpoint, options) {
      const method = options?.method ?? 'GET'
      const headers = { accept: 'application/json' }
      if (options?.body !== undefined) headers['content-type'] = 'application/json'
      const response = await fetch(BASE_PATH + endpoint, {
        method,
        headers,
        ...(options?.body === undefined ? {} : { body: JSON.stringify(options.body) })
      })
      if (!response.ok) throw new Error('宿主返回 HTTP ' + String(response.status))
      const payload = await response.json()
      if (payload?.ok !== true) throw new Error(payload?.error?.message ?? '请求失败')
      return payload.value
    }

    const styles = {
      wrap: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720, color: 'var(--dsw-alias-label-primary)' },
      title: { margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px' },
      intro: { margin: 0, fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-tertiary)' },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 14px',
        border: '0.5px solid var(--dsw-alias-border-l4)',
        borderRadius: 16
      },
      head: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      routeName: { fontSize: 14, fontWeight: 500, lineHeight: '22px' },
      tag: {
        fontSize: 11,
        lineHeight: '16px',
        padding: '1px 6px',
        borderRadius: 4,
        border: '0.5px solid var(--dsw-alias-border-l3)',
        color: 'var(--dsw-alias-label-secondary)'
      },
      meta: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' },
      actions: { display: 'flex', gap: 8, marginTop: 2 },
      primary: {
        height: 32,
        padding: '0 14px',
        border: 'none',
        borderRadius: 16,
        font: 'inherit',
        fontSize: 13,
        cursor: 'pointer',
        background: 'var(--dsw-alias-button-primary-fill)',
        color: 'var(--dsw-alias-label-primary-foreground)'
      },
      secondary: {
        height: 32,
        padding: '0 14px',
        borderRadius: 16,
        font: 'inherit',
        fontSize: 13,
        cursor: 'pointer',
        background: 'transparent',
        border: '1px solid var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-label-secondary)'
      },
      notice: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-success-primary)' },
      warn: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-warn-label)' },
      error: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary)' }
    }

    /** 把一次操作的结果翻译成一句人话。 */
    function describeResult (kind, result) {
      if (kind === 'sync') {
        const added = Array.isArray(result?.added) ? result.added : []
        if (added.length === 0) return '同步完成：中转站共 ' + String(result?.total ?? 0) + ' 个模型，没有缺失'
        const preview = added.slice(0, 5).join('、')
        const more = added.length > 5 ? ' 等 ' + String(added.length) + ' 个' : ''
        return '同步完成：新增 ' + String(added.length) + ' 个模型（' + preview + more + '）'
      }
      const fills = Array.isArray(result?.fills) ? result.fills : []
      if (fills.length === 0) {
        const skipped = Array.isArray(result?.skipped) ? result.skipped : []
        if (skipped.length === 0) return '补全完成：没有需要补全的模型'
        return '没有可自动补全的模型；' + String(skipped.length)
          + ' 个模型的家族认不出来（' + skipped.slice(0, 5).map(item => item.id).join('、')
          + '），需要你决定时请用「用通用模板补全」'
      }
      const generic = fills.filter(item => item.unknown === true).length
      const preview = fills.slice(0, 5).map(item => item.id).join('、')
      const more = fills.length > 5 ? ' 等 ' + String(fills.length) + ' 个' : ''
      return '补全完成：写入 ' + String(fills.length) + ' 个模型的思考等级'
        + (generic > 0 ? '（其中 ' + String(generic) + ' 个用了通用模板）' : '')
        + '：' + preview + more
    }

    /** 单条路由的卡片。 */
    function RouteCard (props) {
      const route = props.route
      const busy = props.busy
      const run = props.run
      const models = Array.isArray(route.models) ? route.models : []
      const pending = models.filter(model => !model.declared)
      const fillable = pending.filter(model => model.suggested !== null)
      const unknown = pending.filter(model => model.suggested === null)
      const blocked = route.writable !== true
      const busyNow = busy !== ''
      const listOf = items => items.slice(0, 6).map(model => model.id).join('、')
        + (items.length > 6 ? ' 等 ' + String(items.length) + ' 个' : '')

      // 按钮为什么不能点，必须写在按钮上 —— 置灰而不解释就是“点了没反应”。
      const fillTitle = blocked
        ? '该路由不可写'
        : (fillable.length > 0
            ? '为 ' + String(fillable.length) + ' 个模型写入按家族确认的思考等级'
            : (pending.length === 0
                ? '该路由的思考等级声明已经完整'
                : '该路由没有可自动补全的模型：剩下的家族认不出来'))

      return h('div', { style: styles.card },
        h('div', { style: styles.head },
          h('span', { style: styles.routeName }, route.displayName || route.route),
          h('span', { style: styles.tag }, route.route),
          h('span', { style: styles.meta }, String(route.modelCount) + ' 个模型')
        ),
        h('div', { style: styles.meta }, route.baseURL || '未配置 baseURL'),
        pending.length === 0
          ? h('div', { style: styles.meta }, '思考等级声明完整，没有可补的模型')
          : null,
        fillable.length > 0
          ? h('div', { style: styles.meta }, '可自动补全：' + listOf(fillable))
          : null,
        unknown.length > 0
          ? h('div', { style: styles.meta }, '家族认不出来、需要你决定：' + listOf(unknown))
          : null,
        blocked
          ? h('div', { style: styles.warn }, '已禁用写入：' + (route.blockedReason ?? '该路由不可写'))
          : null,
        h('div', { style: styles.actions },
          h('button', {
            type: 'button',
            style: styles.primary,
            disabled: blocked || busyNow,
            title: blocked ? '该路由不可写' : '读取该路由的 /models，补上用户配置里还没有的模型',
            onClick: () => run('sync:' + route.route, '/sync', { route: route.route })
          }, busy === 'sync:' + route.route ? '同步中…' : '同步模型'),
          h('button', {
            type: 'button',
            style: styles.secondary,
            disabled: blocked || busyNow || fillable.length === 0,
            title: fillTitle,
            onClick: () => run('fill:' + route.route, '/autofill', { route: route.route })
          }, busy === 'fill:' + route.route ? '补全中…' : '补全思考等级' + (fillable.length > 0 ? '（' + String(fillable.length) + '）' : '')),
          unknown.length > 0
            ? h('button', {
              type: 'button',
              style: styles.secondary,
              disabled: blocked || busyNow,
              title: '给认不出家族的模型写入通用模板 off/low/medium/high；上游是否支持这套拼写无法预先确认',
              onClick: () => run('generic:' + route.route, '/autofill', { route: route.route, includeUnknown: true })
            }, busy === 'generic:' + route.route ? '写入中…' : '用通用模板补全（' + String(unknown.length) + '）')
            : null
        )
      )
    }

    /** 设置页区块本体。 */
    function RelayToolkitSection () {
      const [view, setView] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState(null)
      const [error, setError] = React.useState(null)

      const reload = React.useCallback(() => {
        callApi('/status')
          .then(value => { setView(value); setError(null) })
          .catch(cause => setError(cause.message))
      }, [])

      React.useEffect(() => { reload() }, [reload])

      const run = (key, endpoint, body) => {
        setBusy(key)
        setNotice(null)
        setError(null)
        callApi(endpoint, { method: 'POST', body })
          .then(result => {
            setNotice(describeResult(endpoint === '/sync' ? 'sync' : 'autofill', result))
            reload()
          })
          .catch(cause => setError(cause.message))
          .finally(() => setBusy(''))
      }

      const routes = Array.isArray(view?.routes) ? view.routes : []

      return h('div', { style: styles.wrap },
        h('h3', { style: styles.title }, '中转站工具'),
        h('p', { style: styles.intro },
          '为 llm-pi-ai 的中转站路由同步 /models 模型列表、补全缺失的思考等级声明。' +
          '只写用户配置层、只填空缺，不覆盖任何已有声明，也不改动 baseURL 与密钥引用。'
        ),
        error !== null ? h('p', { style: styles.error }, error) : null,
        notice !== null ? h('p', { style: styles.notice }, notice) : null,
        view === null && error === null ? h('p', { style: styles.intro }, '读取中…') : null,
        view !== null && routes.length === 0 ? h('p', { style: styles.intro }, '未发现 llm-pi-ai 路由。') : null,
        ...routes.map(route => h(RouteCard, { key: route.route, route, busy, run })),
        h('div', { style: styles.actions },
          h('button', {
            type: 'button',
            style: styles.secondary,
            disabled: busy !== '',
            onClick: reload
          }, '刷新')
        )
      )
    }

    const inject = ['slots']

    function apply (ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'relay-toolkit',
        order: 95,
        label: () => '中转站工具'
      }, RelayToolkitSection))
    }

    return { name: 'dsh-relay-toolkit', inject, apply }
  }
})
