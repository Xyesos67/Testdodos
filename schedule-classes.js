import {
  classMatchesParallel,
  esc,
  fetchPublishedDayPayload,
  formatRuDate,
  isoPlusDays,
  isoTodayLocal,
  schoolWeekdayFromIso,
} from './fetch-published.js'

const parallel = parseInt(
  String(document.documentElement.getAttribute('data-zameni-parallel') || '').trim(),
  10,
)

const els = {
  titleDate: document.getElementById('publicScheduleDayMeta'),
  status: document.getElementById('publicScheduleStatus'),
  tabToday: document.getElementById('tabPublicScheduleToday'),
  tabTomorrow: document.getElementById('tabPublicScheduleTomorrow'),
  paneToday: document.getElementById('publicScheduleToday'),
  paneTomorrow: document.getElementById('publicScheduleTomorrow'),
}

/** @type {{ today: object | null, tomorrow: object | null }} */
let payloads = { today: null, tomorrow: null }
let activeDayTab = 'tomorrow'
/** @type {{ today: string, tomorrow: string }} */
let dayMetaByTab = { today: 'В· вЂ”', tomorrow: 'В· вЂ”' }
/** Р’С‹Р±СЂР°РЅРЅС‹Р№ РєР»Р°СЃСЃ РґР»СЏ РјРѕР±РёР»СЊРЅС‹С… РєРЅРѕРїРѕРє (РѕР±С‰РёР№ РґР»СЏ СЃРµРіРѕРґРЅСЏ/Р·Р°РІС‚СЂР°, РµСЃР»Рё РµСЃС‚СЊ). */
let selectedClassName = ''

function weekdayLabelRu(isoDate) {
  const d = new Date(`${isoDate}T12:00:00`)
  if (Number.isNaN(d.getTime())) return formatRuDate(isoDate)
  const wd = d.toLocaleDateString('ru-RU', { weekday: 'long' })
  return `${wd} В· ${formatRuDate(isoDate)}`
}

function syncDayMeta() {
  if (!els.titleDate) return
  els.titleDate.textContent = dayMetaByTab[activeDayTab] || 'В· вЂ”'
}

function classScheduleFromPayload(payload) {
  return (
    payload?.classScheduleByClass ||
    payload?.tableSnapshot?.classScheduleByClass ||
    {}
  )
}

function classNamesForParallel(payload) {
  const map = classScheduleFromPayload(payload)
  return Object.keys(map)
    .filter((name) => classMatchesParallel(name, parallel))
    .sort((a, b) => a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' }))
}

function lessonsMapForClass(payload, className) {
  const rows = classScheduleFromPayload(payload)?.[className]
  /** @type {Map<number, { text: string, tone: string, isEvent: boolean }>} */
  const map = new Map()
  if (!Array.isArray(rows)) return map
  for (const row of rows) {
    const lesson = Number(row?.lesson)
    if (!Number.isFinite(lesson) || lesson < 1) continue
    map.set(lesson, {
      text: String(row?.text || '').trim(),
      tone: String(row?.tone || 'base').trim() || 'base',
      isEvent: Boolean(row?.isEvent),
    })
  }
  return map
}

function periodsForParallel(payload, classNames) {
  const headers = Array.isArray(payload?.tableSnapshot?.lessonHeaders)
    ? payload.tableSnapshot.lessonHeaders.map(Number).filter((n) => Number.isFinite(n) && n >= 1)
    : []
  const fromLessons = new Set()
  for (const name of classNames) {
    for (const lesson of lessonsMapForClass(payload, name).keys()) fromLessons.add(lesson)
  }
  if (fromLessons.size) {
    const max = Math.max(...fromLessons)
    // РЎ 1-РіРѕ СѓСЂРѕРєР° вЂ” С‡С‚РѕР±С‹ РІ РЅР°С‡Р°Р»Рµ РґРЅСЏ Р±С‹Р»Рё РІРёРґРЅС‹ РїСЂРѕС‡РµСЂРєРё Сѓ РєР»Р°СЃСЃРѕРІ СЃ РїРѕР·РґРЅРёРј СЃС‚Р°СЂС‚РѕРј
    return Array.from({ length: max }, (_, i) => i + 1)
  }
  if (headers.length) return headers
  return Array.from({ length: 12 }, (_, i) => i + 1)
}

/** РџРµСЂРІС‹Р№ СѓСЂРѕРє РґРЅСЏ СЃ СЃРѕРґРµСЂР¶РёРјС‹Рј (РґР»СЏ РїСЂРѕС‡РµСЂРєРѕРІ РІ РЅР°С‡Р°Р»Рµ). */
function firstLessonPeriod(lessonMap) {
  let min = Infinity
  for (const [period, entry] of lessonMap) {
    if (entry?.text) min = Math.min(min, period)
  }
  return Number.isFinite(min) ? min : null
}

function toneClass(tone) {
  switch (String(tone || '').trim()) {
    case 'substitute':
      return 'tone-duty'
    case 'replaced':
      return 'tone-replaced'
    case 'absent':
      return 'tone-needs'
    case 'cancelled':
      return 'tone-cancelled'
    case 'override':
      return 'tone-override'
    case 'empty':
      return 'tone-empty'
    default:
      return 'tone-base'
  }
}

function formatCellHtml(entry) {
  if (!entry?.text) return ''
  const lines = entry.text
    .split(/\n|;/)
    .map((x) => x.trim())
    .filter(Boolean)
  if (!lines.length) return ''
  return `<div class="parallel-cell-stack">${lines
    .map((line) => `<div class="parallel-cell-line">${esc(line)}</div>`)
    .join('')}</div>`
}

function formatLeadingEmptyHtml() {
  return `<div class="parallel-cell-stack"><div class="parallel-cell-line is-dash">вЂ”</div></div>`
}

function resolveActiveClass(classNames) {
  if (selectedClassName && classNames.includes(selectedClassName)) return selectedClassName
  return classNames[0] || ''
}

function applyClassSelection(sheet, className) {
  if (!sheet || !className) return
  selectedClassName = className
  sheet.setAttribute('data-active-class', className)

  sheet.querySelectorAll('.parallel-class-btn').forEach((btn) => {
    const on = btn.getAttribute('data-class') === className
    btn.classList.toggle('is-active', on)
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
  })

  sheet.querySelectorAll('[data-class].parallel-class-col, [data-class].parallel-cell').forEach((el) => {
    el.classList.toggle('is-active-col', el.getAttribute('data-class') === className)
  })
}

function bindClassPickers(root) {
  if (!root) return
  root.querySelectorAll('.parallel-sheet').forEach((sheet) => {
    const active = sheet.getAttribute('data-active-class') || ''
    applyClassSelection(sheet, active)

    sheet.querySelectorAll('.parallel-class-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-class') || ''
        if (!name) return
        // РЎРёРЅС…СЂРѕРЅРёР·РёСЂСѓРµРј РІС‹Р±РѕСЂ РЅР° РѕР±РµРёС… РїР°РЅРµР»СЏС… (СЃРµРіРѕРґРЅСЏ/Р·Р°РІС‚СЂР°)
        document.querySelectorAll('.parallel-sheet').forEach((other) => {
          const names = [...other.querySelectorAll('.parallel-class-btn')].map((b) =>
            b.getAttribute('data-class'),
          )
          if (names.includes(name)) applyClassSelection(other, name)
        })
      })
    })
  })
}

function buildParallelGrid(payload, dateStr) {
  if (schoolWeekdayFromIso(dateStr) == null) {
    return `<p class="muted">Р’С‹С…РѕРґРЅРѕР№ РґРµРЅСЊ В· ${esc(formatRuDate(dateStr))}</p>`
  }
  if (!payload) {
    return `<p class="muted">РќРµС‚ С„Р°Р№Р»Р° published-${esc(dateStr)}.json РІ data/public-substitutions/.</p>`
  }

  const classNames = classNamesForParallel(payload)
  if (!classNames.length) {
    return `<p class="muted">РќРµС‚ РєР»Р°СЃСЃРѕРІ ${esc(String(parallel))} РїР°СЂР°Р»Р»РµР»Рё РІ РѕРїСѓР±Р»РёРєРѕРІР°РЅРЅС‹С… Р·Р°РјРµРЅР°С….</p>`
  }

  const activeClass = resolveActiveClass(classNames)
  const periods = periodsForParallel(payload, classNames)
  const byClass = Object.fromEntries(
    classNames.map((name) => [name, lessonsMapForClass(payload, name)]),
  )
  const firstByClass = Object.fromEntries(
    classNames.map((name) => [name, firstLessonPeriod(byClass[name])]),
  )

  const picker = `<div class="parallel-class-picker" role="tablist" aria-label="РљР»Р°СЃСЃС‹ РїР°СЂР°Р»Р»РµР»Рё">
    ${classNames
      .map((name) => {
        const on = name === activeClass
        return `<button type="button" class="parallel-class-btn${on ? ' is-active' : ''}" data-class="${esc(name)}" role="tab" aria-pressed="${on ? 'true' : 'false'}">${esc(name)}</button>`
      })
      .join('')}
  </div>`

  const head = classNames
    .map((name) => {
      const on = name === activeClass ? ' is-active-col' : ''
      return `<th class="parallel-class-col${on}" data-class="${esc(name)}">${esc(name)}</th>`
    })
    .join('')

  const body = periods
    .map((period) => {
      const cells = classNames
        .map((name) => {
          const entry = byClass[name]?.get(period)
          const first = firstByClass[name]
          const leadingEmpty = !entry?.text && first != null && period < first
          const cls = [
            'parallel-cell',
            leadingEmpty ? 'tone-empty is-dash' : toneClass(entry?.tone),
            entry?.isEvent ? 'is-event' : '',
            name === activeClass ? 'is-active-col' : '',
          ]
            .filter(Boolean)
            .join(' ')
          const inner = leadingEmpty ? formatLeadingEmptyHtml() : formatCellHtml(entry)
          return `<td class="${cls}" data-class="${esc(name)}">${inner}</td>`
        })
        .join('')
      return `<tr><th class="parallel-period">${esc(String(period))}</th>${cells}</tr>`
    })
    .join('')

  return `<div class="parallel-sheet" data-active-class="${esc(activeClass)}">
    ${picker}
    <div class="parallel-scroll">
      <table class="parallel-table">
        <thead>
          <tr>
            <th class="parallel-period-head">в„–</th>
            ${head}
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </div>`
}

function renderPane(pane, payload, dateStr) {
  if (!pane) return
  pane.innerHTML = buildParallelGrid(payload, dateStr)
  bindClassPickers(pane)
}

function applyActiveDayTab() {
  const isToday = activeDayTab === 'today'
  els.paneToday?.classList.toggle('hidden', !isToday)
  els.paneTomorrow?.classList.toggle('hidden', isToday)
  els.tabToday?.setAttribute('aria-selected', isToday ? 'true' : 'false')
  els.tabTomorrow?.setAttribute('aria-selected', isToday ? 'false' : 'true')
  syncDayMeta()
}

async function loadAndRender() {
  if (!Number.isFinite(parallel) || parallel < 1) {
    if (els.status) els.status.textContent = 'РќРµ Р·Р°РґР°РЅР° РїР°СЂР°Р»Р»РµР»СЊ (data-zameni-parallel).'
    return
  }
  if (els.status) els.status.textContent = 'Р—Р°РіСЂСѓР·РєР°вЂ¦'

  const today = isoTodayLocal()
  const tomorrow = isoPlusDays(today, 1)

  try {
    const [todayRes, tomorrowRes] = await Promise.all([
      fetchPublishedDayPayload(today),
      fetchPublishedDayPayload(tomorrow),
    ])
    payloads = {
      today: todayRes.found ? todayRes.payload : null,
      tomorrow: tomorrowRes.found ? tomorrowRes.payload : null,
    }

    dayMetaByTab = {
      today: `В· ${weekdayLabelRu(today)}`,
      tomorrow: `В· ${weekdayLabelRu(tomorrow)}`,
    }

    renderPane(els.paneToday, payloads.today, today)
    renderPane(els.paneTomorrow, payloads.tomorrow, tomorrow)
    syncDayMeta()

    if (!todayRes.found && !tomorrowRes.found) {
      if (els.status) {
        els.status.textContent =
          'Р¤Р°Р№Р»С‹ published-*.json РЅРµ РЅР°Р№РґРµРЅС‹. РџРѕР»РѕР¶РёС‚Рµ РІС‹РіСЂСѓР·РєСѓ Р±РѕС‚Р° РІ data/public-substitutions/.'
      }
    } else if (els.status) {
      els.status.textContent = ''
    }
  } catch (e) {
    if (els.status) els.status.textContent = `РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё: ${e?.message || e}`
  }

  applyActiveDayTab()
}

els.tabToday?.addEventListener('click', () => {
  activeDayTab = 'today'
  applyActiveDayTab()
})
els.tabTomorrow?.addEventListener('click', () => {
  activeDayTab = 'tomorrow'
  applyActiveDayTab()
})