/**
 * dsh-relay-toolkit —— 浏览器半侧。
 *
 * 在设置页注册一个「中转站工具」区块：列出 llm-pi-ai 的每条中转站路由，
 * 显示思考等级声明的缺失情况，并提供六个动作 —— 同步模型、补全思考等级、
 * 用通用模板补全、对齐窗口与输出、补全图像声明、测试连通性。
 *
 * 数据全部来自宿主半侧挂在 `/api/relay-toolkit` 下的只读/写入端点，
 * 这里不做任何本地推断：界面上显示的“建议”就是宿主将要写入的内容。
 * 唯一的例外是探测结果 —— 它是**一次性观察**，不进只读视图（那份视图代表配置），
 * 所以按路由存在组件自己的 state 里。
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
      error: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary)' },
      probeBox: {
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        marginTop: 2,
        padding: '8px 10px',
        borderRadius: 10,
        background: 'var(--dsw-alias-bg-base-l2, transparent)',
        border: '0.5px solid var(--dsw-alias-border-l4)'
      },
      probeRow: { display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12, lineHeight: '18px' },
      probeId: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 },
      probeOk: { color: 'var(--dsw-alias-state-success-primary)', flexShrink: 0 },
      probeFail: { color: 'var(--dsw-alias-state-error-primary)', flexShrink: 0 },
      probeDetail: { color: 'var(--dsw-alias-label-tertiary)' }
    }

    /** token 数写成 K/M 简写，跟官方设置页的习惯一致。 */
    function formatCapacity (value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return ''
      if (value >= 1000000) return String(Math.round(value / 100000) / 10) + 'M'
      if (value >= 1000) return String(Math.round(value / 1000)) + 'K'
      return String(value)
    }

    /** 「200K / 128K」——窗口 / 最大输出。 */
    function capacityText (fill) {
      const parts = []
      if (typeof fill.contextWindow === 'number') parts.push(formatCapacity(fill.contextWindow))
      if (typeof fill.maxTokens === 'number') parts.push(formatCapacity(fill.maxTokens))
      return parts.join(' / ')
    }

    /** 把一次操作的结果翻译成一句人话。 */
    function describeResult (kind, result) {
      if (kind === 'modalities') {
        const fills = Array.isArray(result?.fills) ? result.fills : []
        const skipped = Array.isArray(result?.skipped) ? result.skipped : []
        if (fills.length === 0) {
          return '没有可补全的图像声明'
            + (skipped.length > 0
                ? '；' + String(skipped.length) + ' 个模型的官方能力认不出（'
                  + skipped.slice(0, 5).map(item => item.id).join('、') + '）'
                : '：这些条目要么已经声明过 input，要么不在用户配置层')
        }
        const preview = fills.slice(0, 5).map(item => item.id).join('、')
        const more = fills.length > 5 ? ' 等 ' + String(fills.length) + ' 个' : ''
        return '已为 ' + String(fills.length) + ' 个模型写入 input: [text, image]：' + preview + more
          + '。请实测一次读图，确认这个中转站真的向上游透传图像'
      }
      if (kind === 'align') {
        const fills = Array.isArray(result?.fills) ? result.fills : []
        const skipped = Array.isArray(result?.skipped) ? result.skipped : []
        const errors = Array.isArray(result?.discoveryErrors) ? result.discoveryErrors : []
        const fromSpec = fills.filter(item => item.source === 'spec').length
        if (fills.length === 0) {
          const reason = skipped.find(item => typeof item.reason === 'string')?.reason
          const suffix = errors.length > 0 ? '（发现失败：' + errors[0].reason + '）' : ''
          return '没有可对齐的窗口/输出上限：'
            + (reason ?? '发现结果里没有这些模型的容量数值，内置规格表也认不出')
            + suffix
        }
        const preview = fills.slice(0, 3).map(item => item.id + ' → ' + capacityText(item)).join('、')
        const more = fills.length > 3 ? ' 等 ' + String(fills.length) + ' 个' : ''
        return '对齐完成：写入 ' + String(fills.length) + ' 个模型（' + preview + more + '）'
          + (fromSpec > 0 ? '；其中 ' + String(fromSpec) + ' 个用了内置规格表（官方值，非上游实测）' : '')
          + (skipped.length > 0 ? '；另有 ' + String(skipped.length) + ' 个没有可用数值' : '')
          + (errors.length > 0 ? '；' + String(errors.length) + ' 条路由的发现失败' : '')
      }
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
          + ' 个模型没有可写入的档位（' + skipped.slice(0, 5).map(item => item.id).join('、')
          + '）：认不出家族的可用「用通用模板补全」，官方不支持档位的建议保持不动'
      }
      const generic = fills.filter(item => item.unknown === true).length
      const preview = fills.slice(0, 5).map(item => item.id).join('、')
      const more = fills.length > 5 ? ' 等 ' + String(fills.length) + ' 个' : ''
      return '补全完成：写入 ' + String(fills.length) + ' 个模型的思考等级'
        + (generic > 0 ? '（其中 ' + String(generic) + ' 个用了通用模板）' : '')
        + '：' + preview + more
    }

    /**
     * 探测结果面板。
     *
     * 失败排在前面：这个面板要回答的是「哪些模型其实不能用」，
     * 把通的一堆堆在上面只会把真正要看的信息挤下去。
     */
    function ProbeResult (props) {
      const result = props.result
      const results = Array.isArray(result?.results) ? result.results : []
      const failed = results.filter(item => item.ok !== true)
      const passed = results.filter(item => item.ok === true)
      const ordered = [...failed, ...passed]

      return h('div', { style: styles.probeBox },
        h('div', { style: styles.meta },
          '连通性探测：向 ' + result.baseURL + ' 发 "' + result.prompt + '"，'
          + String(result.okCount) + ' 个可用 / ' + String(result.failedCount) + ' 个失败'
          + (result.truncated === true ? '（只探了前 ' + String(results.length) + ' 个）' : '')
        ),
        ...ordered.map(item => h('div', { key: item.id, style: styles.probeRow },
          h('span', { style: item.ok === true ? styles.probeOk : styles.probeFail }, item.ok === true ? '✓' : '✗'),
          h('span', { style: styles.probeId }, item.id),
          h('span', { style: styles.probeDetail },
            item.ok === true
              ? String(item.ms) + 'ms' + (item.reply ? ' · ' + item.reply : '')
                + (item.usage?.outputTokens !== undefined ? ' · 输出 ' + String(item.usage.outputTokens) + ' token' : '')
              : String(item.ms) + 'ms · ' + item.reason)
        ))
      )
    }

    /** 单条路由的卡片。 */
    function RouteCard (props) {
      const route = props.route
      const busy = props.busy
      const run = props.run
      const probe = props.probe
      const models = Array.isArray(route.models) ? route.models : []
      const pending = models.filter(model => !model.declared)
      const fillable = pending.filter(model => model.suggested !== null)
      // 剩下的必须分两类说：一类是官方认得出、但确认不支持档位（刻意不写），
      // 另一类才是真正认不出家族的。混为一谈会让界面把前者也列进「用通用模板补全」，
      // 而那恰好是插件刻意避免的有害写入。
      const unsupported = pending.filter(model => model.suggested === null && typeof model.unsupported === 'string')
      const unknown = pending.filter(model => model.suggested === null && typeof model.unsupported !== 'string')
      // 官方确认能收图、但条目里还没声明 input 的模型 —— 这些是「模型支持却读不了图」的候选。
      const visionMissing = models.filter(model => model.inputDeclared !== true && typeof model.vision === 'string')
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
                : (unknown.length > 0
                    ? '该路由没有可自动补全的模型：剩下的家族认不出来'
                    : '该路由没有可自动补全的模型：剩下的模型官方不支持档位，不该补')))

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
        unsupported.length > 0
          ? h('div', { style: styles.meta }, '官方不支持档位、刻意跳过：' + listOf(unsupported))
          : null,
        unknown.length > 0
          ? h('div', { style: styles.meta }, '家族认不出来、需要你决定：' + listOf(unknown))
          : null,
        route.undimensioned > 0
          ? h('div', { style: styles.meta }, '窗口/输出上限未声明：' + String(route.undimensioned) + ' 个')
          : null,
        visionMissing.length > 0
          ? h('div', { style: styles.meta }, '官方确认支持图像、但未声明 input：' + listOf(visionMissing))
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
            : null,
          route.undimensioned > 0
            ? h('button', {
              type: 'button',
              style: styles.secondary,
              disabled: blocked || busyNow,
              title: '用 DSH 自己的模型发现取官方的上下文窗口与最大输出，写进还没声明这两项的模型',
              onClick: () => run('align:' + route.route, '/align', { route: route.route })
            }, busy === 'align:' + route.route ? '对齐中…' : '对齐窗口与输出（' + String(route.undimensioned) + '）')
            : null,
          visionMissing.length > 0
            ? h('button', {
              type: 'button',
              style: styles.secondary,
              disabled: blocked || busyNow,
              title: '写入 input: [text, image]。官方确认这些模型能收图，但你的中转站是否透传图像必须自己实测',
              onClick: () => run('vision:' + route.route, '/modalities', { route: route.route })
            }, busy === 'vision:' + route.route ? '写入中…' : '补全图像声明（' + String(visionMissing.length) + '）')
            : null,
          // 探测不写配置，所以**不受 writable 限制** —— 不可写的路由照样能测连通性。
          h('button', {
            type: 'button',
            style: styles.secondary,
            disabled: busyNow || models.length === 0,
            title: models.length === 0
              ? '该路由没有模型可探测'
              : '向该路由逐个发一句 "hi"，确认模型是否真的可用。会向上游发出真实的计费请求（每次约几十 token），只读不写配置',
            onClick: () => run('probe:' + route.route, '/probe', { route: route.route })
          }, busy === 'probe:' + route.route
            ? '探测中…'
            : '测试连通性（' + String(models.length) + '）')
        ),
        probe !== undefined && probe !== null ? h(ProbeResult, { result: probe }) : null
      )
    }

    /** 设置页区块本体。 */
    function RelayToolkitSection () {
      const [view, setView] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [notice, setNotice] = React.useState(null)
      const [error, setError] = React.useState(null)
      // 探测结果按路由存：它是**一次性**的观察结果，不该被 reload 冲掉，
      // 也不该混进只读视图（那份视图代表的是配置，不是探测快照）。
      const [probes, setProbes] = React.useState({})

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
        // 探测有自己的结果面板，不该再占用顶部那行一次性提示。
        const isProbe = endpoint === '/probe'
        callApi(endpoint, { method: 'POST', body })
          .then(result => {
            if (isProbe) {
              setProbes(previous => ({ ...previous, [body.route]: result }))
              setNotice('连通性探测完成：' + String(result.okCount) + ' 个可用 / '
                + String(result.failedCount) + ' 个失败（详见卡片下方的结果）')
              return
            }
            const kinds = { '/sync': 'sync', '/align': 'align', '/modalities': 'modalities' }
            setNotice(describeResult(kinds[endpoint] ?? 'autofill', result))
            reload()
          })
          .catch(cause => setError(cause.message))
          .finally(() => setBusy(''))
      }

      const routes = Array.isArray(view?.routes) ? view.routes : []

      // 默认模型缺图像声明，正是「模型支持却读不了图」的直接成因 —— 拎到最上面说。
      const defaultModel = view?.defaultModel
      const visionGap = defaultModel !== undefined && defaultModel !== null
        && defaultModel.resolved === true && defaultModel.declaresImage !== true
      const visionHint = visionGap
        ? '当前默认模型 ' + defaultModel.provider + '/' + defaultModel.model
          + ' 未声明图像输入，read_image 之类的工具会被直接拒绝。'
          + (defaultModel.visionCapable
              ? '官方确认该模型支持图像，请到对应卡片点「补全图像声明」。'
              : '官方能力表里认不出它，插件不会替你写这个声明。')
          + (defaultModel.inUserLayer ? '' : '（该模型条目不在用户配置层，需要手工处理。）')
        : null

      return h('div', { style: styles.wrap },
        h('h3', { style: styles.title }, '中转站工具'),
        h('p', { style: styles.intro },
          '为 llm-pi-ai 的中转站路由同步 /models 模型列表、补全缺失的思考等级声明。' +
          '只写用户配置层、只填空缺，不覆盖任何已有声明，也不改动 baseURL 与密钥引用。' +
          '「测试连通性」会向该路由逐个发一句 "hi" —— 那是真实的上游计费请求，但只读不写配置。'
        ),
        error !== null ? h('p', { style: styles.error }, error) : null,
        visionHint !== null ? h('p', { style: styles.warn }, visionHint) : null,
        notice !== null ? h('p', { style: styles.notice }, notice) : null,
        view === null && error === null ? h('p', { style: styles.intro }, '读取中…') : null,
        view !== null && routes.length === 0 ? h('p', { style: styles.intro }, '未发现 llm-pi-ai 路由。') : null,
        ...routes.map(route => h(RouteCard, {
          key: route.route,
          route,
          busy,
          run,
          probe: probes[route.route]
        })),
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
