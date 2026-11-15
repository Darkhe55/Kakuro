/**
 * 数和（Kakuro）—— 自定义题板扩展面板
 *
 * 复用 core 的通用 CustomEditor：
 *   - 网格里点击 / 键盘 1 循环「白格 → 黑格」，画出布局；
 *   - 本面板负责给选中的黑格录入横向 / 纵向提示和；
 *   - 另提供紧凑文本导入 / 导出，便于快速搭题与编辑回填。
 *
 * 题面格式（文本导入）：
 *   每行一行，单元格用空格分隔；白格写 "."，黑格写 "横.纵"（0 表示该方向无提示）
 *   或者用 "#" 表示无提示黑格。例如：
 *     # # # # #
 *     # 12.0 0.7 . .
 *     ...
 */

import type { CustomAudit, CustomEditorControl } from '../core/types.ts'
import { getModel, decodeBoard, encodeBoard, MAX_SIZE } from './rules.ts'
import { planLogicSolve } from './logic.ts'
import { countSolutions } from './solver.ts'
import { asKakuroPuzzle, type KakuroPuzzle, type KakuroState } from './types.ts'

const PREFIX = 'kakuro-custom-'

interface Draft {
  w: number
  h: number
  hClues: number[]
  vClues: number[]
}

let draft: Draft = { w: 0, h: 0, hClues: [], vClues: [] }
let ctlRef: CustomEditorControl | null = null
let bound = false

function ensureDraft(w: number, h: number): Draft {
  if (draft.w === w && draft.h === h && draft.hClues.length === w * h) return draft
  draft = { w, h, hClues: new Array<number>(w * h).fill(0), vClues: new Array<number>(w * h).fill(0) }
  return draft
}

function clearDraft(w: number, h: number): void {
  draft = { w, h, hClues: new Array<number>(w * h).fill(0), vClues: new Array<number>(w * h).fill(0) }
}

/** 默认布局：第一行 + 第一列黑格（保证每个白格左侧/上方都有提示黑格） */
function defaultGrid(w: number, h: number): Array<number | null> {
  const grid = new Array<number | null>(w * h).fill(null)
  for (let x = 0; x < w; x++) grid[x] = 1
  for (let y = 0; y < h; y++) grid[y * w] = 1
  return grid
}

function isBlank(grid: Array<number | null>): boolean {
  return grid.every((v) => v === null)
}

function needsDirections(
  w: number,
  h: number,
  grid: Array<number | null>,
  index: number,
): { h: boolean; v: boolean } {
  const x = index % w
  const y = Math.floor(index / w)
  const white = (i: number): boolean => grid[i] === null
  return {
    h: x + 1 < w && white(index + 1),
    v: y + 1 < h && white(index + w),
  }
}

/* ────────────────────────── 文本导入 / 导出 ────────────────────────── */

export function exportText(w: number, h: number, grid: Array<number | null>): string {
  const d = ensureDraft(w, h)
  const lines: string[] = []
  for (let y = 0; y < h; y++) {
    const cells: string[] = []
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (grid[i] !== 1) {
        cells.push('.')
        continue
      }
      const need = needsDirections(w, h, grid, i)
      const hc = need.h ? d.hClues[i] ?? 0 : 0
      const vc = need.v ? d.vClues[i] ?? 0 : 0
      cells.push(hc === 0 && vc === 0 ? '#' : `${hc}.${vc}`)
    }
    lines.push(cells.join(' '))
  }
  return lines.join('\n')
}

interface ParsedText {
  w: number
  h: number
  grid: Array<number | null>
  hClues: number[]
  vClues: number[]
}

export function parseText(text: string): ParsedText | null {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length < 3) return null
  const rows = lines.map((line) => line.split(/\s+/))
  const h = rows.length
  const w = rows[0]!.length
  if (w < 3 || h < 3 || w > MAX_SIZE || h > MAX_SIZE) return null
  const grid = new Array<number | null>(w * h).fill(null)
  const hClues = new Array<number>(w * h).fill(0)
  const vClues = new Array<number>(w * h).fill(0)
  for (let y = 0; y < h; y++) {
    const cells = rows[y]!
    if (cells.length !== w) return null
    for (let x = 0; x < w; x++) {
      const token = cells[x]!
      const i = y * w + x
      if (token === '.' || token === '_' || token === '-' || token === '0') {
        grid[i] = null
        continue
      }
      if (token === '#') {
        grid[i] = 1
        continue
      }
      const parts = token.split('.')
      if (parts.length !== 2) return null
      const hc = Number(parts[0])
      const vc = Number(parts[1])
      if (!Number.isInteger(hc) || !Number.isInteger(vc) || hc < 0 || hc > 45 || vc < 0 || vc > 45) {
        return null
      }
      grid[i] = 1
      hClues[i] = hc
      vClues[i] = vc
    }
  }
  return { w, h, grid, hClues, vClues }
}

/* ────────────────────────── 由草稿构造题目 ────────────────────────── */

export function buildCustomPuzzle(
  w: number,
  h: number,
  grid: Array<number | null>,
  existingId?: string,
): KakuroPuzzle {
  const d = ensureDraft(w, h)
  const blocks = new Array<number>(w * h).fill(0)
  const hClues = new Array<number>(w * h).fill(0)
  const vClues = new Array<number>(w * h).fill(0)
  for (let i = 0; i < w * h; i++) {
    if (grid[i] !== 1) continue
    blocks[i] = 1
    const need = needsDirections(w, h, grid, i)
    const hc = need.h ? d.hClues[i] ?? 0 : 0
    const vc = need.v ? d.vClues[i] ?? 0 : 0
    hClues[i] = hc >= 1 && hc <= 45 ? hc : 0
    vClues[i] = vc >= 1 && vc <= 45 ? vc : 0
  }
  return {
    id: existingId ?? `${PREFIX}${w}x${h}-${Date.now()}`,
    name: `自定义 · ${w}×${h}`,
    width: w,
    height: h,
    difficulty: 'custom',
    blocks,
    hClues,
    vClues,
  }
}

export function toCustomGrid(p: KakuroPuzzle): { width: number; height: number; grid: Array<number | null> } {
  if (!Array.isArray(p.blocks) || p.blocks.length !== p.width * p.height) return { width: 0, height: 0, grid: [] }
  return {
    width: p.width,
    height: p.height,
    grid: Array.from(p.blocks, (v) => (v ? 1 : null)),
  }
}

export function encodeCustomPuzzle(p: KakuroPuzzle): Record<string, unknown> {
  return { board: encodeBoard(p) }
}

export function decodeCustomPuzzle(record: Record<string, unknown>): KakuroPuzzle | null {
  const width = Number(record.width)
  const height = Number(record.height)
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null
  if (width < 3 || height < 3 || width > MAX_SIZE || height > MAX_SIZE) return null
  const board = typeof record.board === 'string' ? decodeBoard(record.board, width, height) : null
  if (!board) return null
  return {
    id: typeof record.id === 'string' ? record.id : `${PREFIX}${width}x${height}`,
    name: typeof record.name === 'string' && record.name ? record.name : `自定义 · ${width}×${height}`,
    width,
    height,
    difficulty: 'custom',
    blocks: board.blocks,
    hClues: board.hClues,
    vClues: board.vClues,
  }
}

/** 保存 / 载入自定义题时的审计：题面结构、唯一解、逻辑可解性 */
export function auditCustomPuzzle(p: KakuroPuzzle): CustomAudit {
  const model = getModel(p)
  if (model.issues.length > 0) {
    return {
      ok: false,
      message: `题面有 ${model.issues.length} 个问题：${model.issues[0]}${model.issues.length > 1 ? '…' : ''}`,
    }
  }
  const counted = countSolutions(p, 2, 250_000, 3500)
  if (counted.timedOut) {
    return { ok: false, message: '求解超时，无法确认唯一解（可先减小盘面或补全提示）。' }
  }
  if (counted.count === 0) return { ok: false, message: '该题面无解，请检查黑格布局与提示和。' }
  if (counted.count > 1) {
    return { ok: false, message: `该题面有多个解（至少 ${counted.count} 个），提示和还需要加强。` }
  }
  const emptyState: KakuroState = {
    puzzleId: p.id,
    width: p.width,
    height: p.height,
    values: new Array<number>(p.width * p.height).fill(0),
  }
  const plan = planLogicSolve(p, emptyState)
  const logicOk = plan.frames.length > 0 && plan.saturated
  return {
    ok: true,
    message: logicOk
      ? '唯一解 · 逻辑规则可推满。'
      : '唯一解（逻辑求解可能中途卡关，可用「求解」补全）。',
  }
}

/* ────────────────────────── 面板 ────────────────────────── */

function html(): string {
  return `
  <div class="kk-editor">
    <div class="kk-editor-title">黑格提示和</div>
    <div class="kk-editor-pick" id="kk-editor-pick">在网格里点击黑格，然后录入横向 / 纵向提示和。</div>
    <div class="kk-editor-row">
      <label>横向和 <input id="kk-editor-h" type="number" min="0" max="45" step="1" inputmode="numeric" /></label>
      <label>纵向和 <input id="kk-editor-v" type="number" min="0" max="45" step="1" inputmode="numeric" /></label>
    </div>
    <div class="kk-editor-row">
      <button class="btn" id="kk-editor-export" type="button">导出文本</button>
      <button class="btn" id="kk-editor-import" type="button">导入文本</button>
      <button class="btn" id="kk-editor-clear" type="button">清空提示</button>
    </div>
    <textarea id="kk-editor-text" rows="4" spellcheck="false" placeholder="行内单元格用空格分隔：白格写 . ，黑格写 横.纵（0 = 该方向无提示）或 #"></textarea>
    <div class="kk-editor-note" id="kk-editor-note"></div>
  </div>`
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null
}

function updateNote(): void {
  const note = el<HTMLElement>('kk-editor-note')
  const ctl = ctlRef
  if (!note || !ctl) return
  const grid = ctl.grid()
  const w = ctl.width
  const h = ctl.height
  let black = 0
  let missing = 0
  let white = 0
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === 1) {
      black++
      const need = needsDirections(w, h, grid, i)
      const hc = need.h ? draft.hClues[i] ?? 0 : 0
      const vc = need.v ? draft.vClues[i] ?? 0 : 0
      if ((need.h && hc <= 0) || (need.v && vc <= 0)) missing++
    } else {
      white++
    }
  }
  note.textContent = `白格 ${white} · 黑格 ${black} · 缺提示 ${missing}（提示和取 1..45；每段 1..9 格）`
  note.className = 'kk-editor-note' + (missing > 0 ? ' bad' : '')
}

function refreshPicker(): void {
  const ctl = ctlRef
  if (!ctl) return
  const grid = ctl.grid()
  const w = ctl.width
  const h = ctl.height
  const index = ctl.cursor()
  const pick = el<HTMLElement>('kk-editor-pick')
  const hi = el<HTMLInputElement>('kk-editor-h')
  const vi = el<HTMLInputElement>('kk-editor-v')
  if (!pick || !hi || !vi) return
  if (index < 0 || index >= grid.length) {
    pick.textContent = '在网格里点击黑格，然后录入横向 / 纵向提示和。'
    hi.value = ''
    vi.value = ''
    hi.disabled = true
    vi.disabled = true
    return
  }
  const x = index % w
  const y = Math.floor(index / w)
  if (grid[index] !== 1) {
    pick.textContent = `第 ${y + 1} 行第 ${x + 1} 列是白格 —— 点击黑格录入提示和（1 键可把该格涂黑）。`
    hi.value = ''
    vi.value = ''
    hi.disabled = true
    vi.disabled = true
    return
  }
  const need = needsDirections(w, h, grid, index)
  pick.textContent = `第 ${y + 1} 行第 ${x + 1} 列黑格：${need.h ? '横向' : '横向（无段）'} / ${need.v ? '纵向' : '纵向（无段）'}`
  hi.disabled = !need.h
  vi.disabled = !need.v
  hi.value = need.h ? String(draft.hClues[index] || '') : ''
  vi.value = need.v ? String(draft.vClues[index] || '') : ''
}

function applyCycleAfterClick(): void {
  // core 点击会循环格子值；这里把新增黑格的提示初始化为 0 并刷新面板
  updateNote()
  refreshPicker()
}

/** 供 core 的 CustomEditor 读取面板 HTML */
export function kakuroExtrasHtml(): string {
  return html()
}

export function mountKakuroExtras(panel: HTMLElement, ctl: CustomEditorControl): void {
  ctlRef = ctl
  if (!bound) {
    bound = true
    panel.innerHTML = html()
    const hi = el<HTMLInputElement>('kk-editor-h')
    const vi = el<HTMLInputElement>('kk-editor-v')
    const grid = document.getElementById('custom-grid')

    const onInput = (): void => {
      const c = ctlRef
      if (!c) return
      const idx = c.cursor()
      const g = c.grid()
      if (idx < 0 || idx >= g.length || g[idx] !== 1) return
      const need = needsDirections(c.width, c.height, g, idx)
      const hc = need.h ? Number(hi?.value) || 0 : 0
      const vc = need.v ? Number(vi?.value) || 0 : 0
      ensureDraft(c.width, c.height)
      draft.hClues[idx] = Math.max(0, Math.min(45, hc))
      draft.vClues[idx] = Math.max(0, Math.min(45, vc))
      updateNote()
    }
    hi?.addEventListener('input', onInput)
    vi?.addEventListener('input', onInput)

    grid?.addEventListener('click', () => {
      setTimeout(() => applyCycleAfterClick(), 0)
    })
    grid?.addEventListener('focusin', () => {
      setTimeout(() => applyCycleAfterClick(), 0)
    })
    grid?.addEventListener('keyup', () => {
      setTimeout(() => applyCycleAfterClick(), 0)
    })
    // 点击黑格 = 选中（不切换成白格），方便录入提示和；
    // 白格仍由 core 的点击循环切成黑格。右键把黑格变回白格。
    grid?.addEventListener(
      'click',
      (event) => {
        const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.custom-cell')
        if (!target) return
        const index = Number(target.dataset.i)
        const c = ctlRef
        if (!c) return
        const g = c.grid()
        if (g[index] === 1) {
          event.preventDefault()
          event.stopPropagation()
          c.select(index)
          updateNote()
          refreshPicker()
        }
      },
      true,
    )
    grid?.addEventListener('contextmenu', (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.custom-cell')
      const c = ctlRef
      if (!target || !c) return
      event.preventDefault()
      const index = Number(target.dataset.i)
      const g = c.grid()
      if (g[index] === 1) {
        const next = g.slice()
        next[index] = null
        c.setGrid(next)
        c.message('已把该黑格改回白格。', 'ok')
      }
      updateNote()
      refreshPicker()
    })

    el<HTMLButtonElement>('kk-editor-export')?.addEventListener('click', () => {
      const c = ctlRef
      if (!c) return
      ensureDraft(c.width, c.height)
      const text = exportText(c.width, c.height, c.grid())
      const ta = el<HTMLTextAreaElement>('kk-editor-text')
      if (ta) ta.value = text
      c.message('已导出当前题面到文本框，可直接复制 / 修改。', 'ok')
    })

    el<HTMLButtonElement>('kk-editor-import')?.addEventListener('click', () => {
      const c = ctlRef
      if (!c) return
      const ta = el<HTMLTextAreaElement>('kk-editor-text')
      const parsed = parseText(ta?.value ?? '')
      if (!parsed) {
        c.message('文本格式不对：每行单元格用空格分隔，白格 . ，黑格 横.纵 或 #。', 'bad')
        return
      }
      c.setSize(parsed.w, parsed.h)
      clearDraft(parsed.w, parsed.h)
      draft.hClues = parsed.hClues.slice()
      draft.vClues = parsed.vClues.slice()
      c.setGrid(parsed.grid.slice())
      c.message(`已从文本导入 ${parsed.w}×${parsed.h}，可点「保存到题库」或「载入题板」。`, 'ok')
      updateNote()
      refreshPicker()
    })

    el<HTMLButtonElement>('kk-editor-clear')?.addEventListener('click', () => {
      const c = ctlRef
      if (!c) return
      clearDraft(c.width, c.height)
      updateNote()
      refreshPicker()
      c.message('已清空所有提示和。', 'ok')
    })
  }
  ensureDraft(ctl.width, ctl.height)
  updateNote()
  refreshPicker()
}

export function resetKakuroExtras(ctl: CustomEditorControl): void {
  ctlRef = ctl
  clearDraft(ctl.width, ctl.height)
  const grid = ctl.grid()
  if (isBlank(grid)) ctl.setGrid(defaultGrid(ctl.width, ctl.height))
  ensureDraft(ctl.width, ctl.height)
  updateNote()
  refreshPicker()
  ctl.message(
    `已生成 ${ctl.width}×${ctl.height}：第一行 / 第一列默认是黑格。点击白格可涂黑，点击黑格录入提示和。`,
  )
}

export function openKakuroExtras(ctl: CustomEditorControl): void {
  ctlRef = ctl
  ensureDraft(ctl.width, ctl.height)
  const grid = ctl.grid()
  if (isBlank(grid)) {
    ctl.setGrid(defaultGrid(ctl.width, ctl.height))
    clearDraft(ctl.width, ctl.height)
  }
  updateNote()
  refreshPicker()
}

export function loadKakuroExtras(p: KakuroPuzzle, ctl: CustomEditorControl): void {
  ctlRef = ctl
  const kp = asKakuroPuzzle(p)
  clearDraft(kp.width, kp.height)
  for (let i = 0; i < draft.hClues.length; i++) {
    draft.hClues[i] = kp.hClues?.[i] ?? 0
    draft.vClues[i] = kp.vClues?.[i] ?? 0
  }
  updateNote()
  refreshPicker()
}

/** 供调试 / 截图使用：当前编辑器草稿 */
export function getDraftSnapshot(): { w: number; h: number; hClues: number[]; vClues: number[] } {
  return { w: draft.w, h: draft.h, hClues: draft.hClues.slice(), vClues: draft.vClues.slice() }
}
