/**
 * 数和（Kakuro）—— SVG 渲染
 *
 * 黑格：深色底 + 左上横向提示 / 右下纵向提示（中间一条对角分隔线）；
 * 白格：白底 + 大号数字；
 * 选中格：描边强调；同横/纵段的格子淡色提示；错误格红色高亮。
 */

import { cellAtPoint, cellSizeOf, originOf, squareMetrics } from '../core/board.ts'
import type { BoardMetrics, GameState, HitTarget, Puzzle, ValidationResult } from '../core/types.ts'
import { getModel } from './rules.ts'
import { asKakuroPuzzle, asKakuroState, type KakuroResult } from './types.ts'

function baseCell(width: number, height: number): number {
  const span = Math.max(width, height)
  if (span <= 6) return 60
  if (span <= 7) return 56
  if (span <= 8) return 52
  if (span <= 9) return 50
  if (span <= 11) return 44
  if (span <= 14) return 38
  return 32
}

export function metricsFor(puzzle: Puzzle): BoardMetrics {
  const p = asKakuroPuzzle(puzzle)
  const cell = baseCell(p.width, p.height)
  const pad = Math.max(12, Math.round(cell * 0.3))
  return squareMetrics(p.width, p.height, { cell, pad, targetKind: 'cell' })
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

export function renderBoard(
  puzzle: Puzzle,
  state: GameState,
  result: ValidationResult,
  _colorGrid?: unknown,
): string {
  const p = asKakuroPuzzle(puzzle)
  const s = asKakuroState(state)
  const r = result as KakuroResult
  const model = getModel(p)
  const m = metricsFor(p)
  const o = originOf(m)
  const { w: cw, h: ch } = cellSizeOf(m)
  const badCells = new Set(r.badCells ?? [])
  const selected = typeof s.selected === 'number' ? s.selected : -1

  // 同段高亮
  const peer = new Set<number>()
  if (selected >= 0 && model.white.includes(selected)) {
    const hSeg = model.hSeg[selected]!
    const vSeg = model.vSeg[selected]!
    if (hSeg >= 0) for (const cell of model.segments[hSeg]!.cells) peer.add(cell)
    if (vSeg >= 0) for (const cell of model.segments[vSeg]!.cells) peer.add(cell)
    peer.delete(selected)
  }

  // 出错段对应的提示黑格
  const badClues = new Set<number>()
  for (const segId of r.badSegments ?? []) {
    const seg = model.segments[segId]
    if (seg && seg.clueCell >= 0) badClues.add(seg.clueCell)
  }

  const parts: string[] = []
  const boardW = cw * p.width
  const boardH = ch * p.height

  parts.push(
    `<rect class="kk-board-bg" x="${fmt(o.x)}" y="${fmt(o.y)}" width="${fmt(boardW)}" height="${fmt(boardH)}" rx="${fmt(Math.min(10, cw * 0.16))}" />`,
  )

  // 黑格
  const blocks = p.blocks ?? []
  for (let i = 0; i < model.size; i++) {
    if (!blocks[i]) continue
    const x = o.x + (i % p.width) * cw
    const y = o.y + Math.floor(i / p.width) * ch
    parts.push(
      `<rect class="kk-block" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(cw)}" height="${fmt(ch)}" />`,
    )
    parts.push(
      `<line class="kk-block-diag" x1="${fmt(x)}" y1="${fmt(y + ch)}" x2="${fmt(x + cw)}" y2="${fmt(y)}" />`,
    )
    const hClue = p.hClues?.[i] ?? 0
    const vClue = p.vClues?.[i] ?? 0
    const bad = badClues.has(i)
    if (hClue > 0) {
      parts.push(
        `<text class="kk-clue h${bad ? ' bad' : ''}" x="${fmt(x + cw * 0.08)}" y="${fmt(y + ch * 0.3)}" style="font-size:${fmt(cw * 0.3)}px">${hClue}</text>`,
      )
    }
    if (vClue > 0) {
      parts.push(
        `<text class="kk-clue v${bad ? ' bad' : ''}" x="${fmt(x + cw * 0.92)}" y="${fmt(y + ch * 0.9)}" style="font-size:${fmt(cw * 0.3)}px">${vClue}</text>`,
      )
    }
  }

  // 白格
  for (const i of model.white) {
    const x = o.x + (i % p.width) * cw
    const y = o.y + Math.floor(i / p.width) * ch
    const cls = ['kk-cell']
    if (peer.has(i)) cls.push('peer')
    if (badCells.has(i)) cls.push('bad')
    parts.push(
      `<rect class="${cls.join(' ')}" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(cw)}" height="${fmt(ch)}" />`,
    )
    if (badCells.has(i)) {
      parts.push(
        `<rect class="kk-bad" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(cw)}" height="${fmt(ch)}" />`,
      )
    }
    if (i === selected) {
      parts.push(
        `<rect class="kk-sel" x="${fmt(x + 1)}" y="${fmt(y + 1)}" width="${fmt(cw - 2)}" height="${fmt(ch - 2)}" rx="${fmt(cw * 0.12)}" />`,
      )
    }
    const v = s.values?.[i] ?? 0
    if (v >= 1 && v <= 9) {
      parts.push(
        `<text class="kk-num" data-index="${i}" x="${fmt(x + cw / 2)}" y="${fmt(y + ch / 2 + cw * 0.02)}" style="font-size:${fmt(cw * 0.54)}px">${v}</text>`,
      )
    }
    if (v === 0) parts.push(noteDigits(s.notes?.[i] ?? 0, x, y, cw, cw))
    // 透明命中层
    parts.push(
      `<rect class="cell-hit" data-cell="${i}" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(cw)}" height="${fmt(ch)}" />`,
    )
  }

  // 外框
  parts.push(
    `<rect class="kk-outline" x="${fmt(o.x)}" y="${fmt(o.y)}" width="${fmt(boardW)}" height="${fmt(boardH)}" rx="${fmt(Math.min(10, cw * 0.16))}" />`,
  )

  return `<svg class="board-svg kk-board" viewBox="0 0 ${fmt(m.svgWidth)} ${fmt(m.svgHeight)}" width="${m.svgWidth}" height="${m.svgHeight}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}

/** 候选数（笔记）：格内 3×3 小格显示，bit d-1 = 数字 d */
function noteDigits(mask: number, x: number, y: number, size: number, cell: number): string {
  if (!mask) return ''
  const step = size / 3
  const fontSize = Math.max(6, cell * 0.24)
  const out: string[] = []
  for (let d = 1; d <= 9; d++) {
    if ((mask & (1 << (d - 1))) === 0) continue
    const col = (d - 1) % 3
    const row = Math.floor((d - 1) / 3)
    const cx = x + step * (col + 0.5)
    const cy = y + step * (row + 0.5)
    out.push(
      `<text class="cell-note" x="${cx.toFixed(2)}" y="${(cy + fontSize * 0.02).toFixed(2)}" style="font-size:${fontSize.toFixed(2)}px">${d}</text>`,
    )
  }
  return out.join('')
}

export function hitTest(m: BoardMetrics, puzzle: Puzzle, x: number, y: number): HitTarget | null {
  const p = asKakuroPuzzle(puzzle)
  const model = getModel(p)
  const index = cellAtPoint(m, x, y)
  if (index === null) return null
  if (!model.white.includes(index)) return null
  return { index, kind: 'cell' }
}

/** 落子特效用：给当前数字一个短促 pop 动画 */
export function flashForMove(
  svg: SVGSVGElement,
  move: { index: number; from: number; to: number },
  _streak: number,
): void {
  const el = svg.querySelector<SVGElement>(`.kk-num[data-index="${move.index}"]`)
  if (!el) return
  el.classList.remove('kk-pop')
  void el.getBoundingClientRect()
  el.classList.add('kk-pop')
  setTimeout(() => el.classList.remove('kk-pop'), 520)
}
