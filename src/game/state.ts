/**
 * 数和（Kakuro）—— 盘面状态与落子
 */

import type { GameState, HitTarget, Move, Puzzle } from '../core/types.ts'
import { getModel } from './rules.ts'
import { asKakuroPuzzle, asKakuroState, type KakuroState } from './types.ts'

export function makeState(puzzle: Puzzle, values: ArrayLike<number>, selected?: number): KakuroState {
  const p = asKakuroPuzzle(puzzle)
  const size = p.width * p.height
  const out = new Array<number>(size).fill(0)
  const model = getModel(p)
  for (let i = 0; i < size; i++) {
    const block = !!p.blocks?.[i]
    const raw = Math.floor(values[i] ?? 0)
    out[i] = !block && raw >= 1 && raw <= 9 ? raw : 0
  }
  const firstWhite = model.white[0]
  return {
    puzzleId: p.id,
    width: p.width,
    height: p.height,
    values: out,
    selected: selected !== undefined ? selected : firstWhite,
  }
}

export function createEmptyState(puzzle: Puzzle): KakuroState {
  return makeState(puzzle, [])
}

export function cloneState(state: GameState): KakuroState {
  const s = asKakuroState(state)
  return {
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    values: Array.from(s.values, (v) => Math.floor(v) || 0),
    selected: s.selected,
  }
}

function valueOf(state: GameState, index: number): number {
  const s = asKakuroState(state)
  const v = s.values[index] ?? 0
  return v >= 1 && v <= 9 ? v : 0
}

/** 左键：选中格子并循环 0 → 1 → … → 9 → 0 */
export function cycleValue(state: GameState, target: HitTarget): number {
  const s = asKakuroState(state)
  const index = target.index
  if (index < 0 || index >= s.values.length) return 0
  s.selected = index
  const v = valueOf(state, index)
  return v >= 9 ? 0 : v + 1
}

/** 右键：选中并清除 */
export function rightClickValue(state: GameState, target: HitTarget): number {
  const s = asKakuroState(state)
  if (target.index >= 0 && target.index < s.values.length) s.selected = target.index
  return 0
}

export function applyMove(state: GameState, move: Move): void {
  const s = asKakuroState(state)
  if (move.index < 0 || move.index >= s.values.length) return
  const v = Math.floor(move.to)
  s.values[move.index] = v >= 1 && v <= 9 ? v : 0
}

export function invertMove(move: Move): Move {
  return { index: move.index, from: move.to, to: move.from }
}

export function valueAt(state: GameState, index: number): number {
  return valueOf(state, index)
}

/* ────────────────────────────── 键盘 ────────────────────────────── */

export function cursorOf(state: GameState): number | null {
  const s = asKakuroState(state)
  const index = s.selected
  if (typeof index !== 'number' || index < 0 || index >= s.values.length) return null
  return index
}

export function setCursor(state: GameState, index: number | null): void {
  const s = asKakuroState(state)
  s.selected = index ?? undefined
}

/** 方向键移动：跳过黑格，找同方向最近的白格 */
export function moveCursor(
  state: GameState,
  puzzle: Puzzle,
  index: number | null,
  dx: number,
  dy: number,
): number | null {
  const p = asKakuroPuzzle(puzzle)
  const model = getModel(p)
  const s = asKakuroState(state)
  let cur = index
  if (cur === null || cur < 0 || cur >= model.size) {
    cur = model.white[0] ?? null
    return cur
  }
  let x = cur % p.width
  let y = Math.floor(cur / p.width)
  for (let step = 0; step < Math.max(p.width, p.height) + 1; step++) {
    x += dx
    y += dy
    if (x < 0 || y < 0 || x >= p.width || y >= p.height) return cur
    const next = y * p.width + x
    if (model.white.includes(next)) {
      s.selected = next
      return next
    }
  }
  return cur
}

/** 数字键入：digit 1..9 填数，0 清空 */
export function keyboardInput(
  state: GameState,
  puzzle: Puzzle,
  index: number,
  digit: number,
): Move | null {
  const p = asKakuroPuzzle(puzzle)
  const model = getModel(p)
  if (index < 0 || index >= model.size) return null
  if (!model.white.includes(index)) return null
  const from = valueOf(state, index)
  const to = digit >= 1 && digit <= 9 ? digit : 0
  if (from === to) return null
  return { index, from, to }
}

/* ────────────────────────────── 存档 ────────────────────────────── */

export function serializeState(state: GameState): Record<string, unknown> {
  const s = asKakuroState(state)
  let values = ''
  for (let i = 0; i < s.values.length; i++) values += String(Math.max(0, Math.min(9, Math.floor(s.values[i] ?? 0))))
  return {
    version: 2,
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    values,
    selected: typeof s.selected === 'number' ? s.selected : null,
  }
}

export function deserializeState(data: Record<string, unknown>): KakuroState | null {
  if (typeof data.puzzleId !== 'string') return null
  const width = Number(data.width)
  const height = Number(data.height)
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null
  const size = width * height
  // 存档上限与题面一致：识图导入的大盘面可以到 MAX_BOARD_SIZE(64)×64 = 4096 格。
  // 旧存档（≤20×20）完全不受影响。
  if (size <= 0 || size > 4096) return null
  const out = new Array<number>(size).fill(0)
  const values = data.values
  if (typeof values === 'string') {
    if (values.length !== size) return null
    for (let i = 0; i < size; i++) {
      const d = values.charCodeAt(i) - 48
      if (d < 0 || d > 9) return null
      out[i] = d
    }
  } else if (Array.isArray(values) && values.length === size) {
    for (let i = 0; i < size; i++) {
      const d = Number(values[i])
      if (!Number.isInteger(d) || d < 0 || d > 9) return null
      out[i] = d
    }
  } else {
    return null
  }
  const selected = typeof data.selected === 'number' && data.selected >= 0 && data.selected < size
    ? data.selected
    : undefined
  return { puzzleId: data.puzzleId, width, height, values: out, selected }
}

/** 提示一格：优先补第一个空格，其次纠正第一个错格 */
export function firstHintMove(state: GameState, solution: GameState): Move | null {
  const s = asKakuroState(state)
  const sol = asKakuroState(solution)
  const size = Math.min(s.values.length, sol.values.length)
  for (let i = 0; i < size; i++) {
    const target = sol.values[i] ?? 0
    if (target < 1 || target > 9) continue
    const cur = s.values[i] ?? 0
    if (cur === 0) return { index: i, from: 0, to: target }
  }
  for (let i = 0; i < size; i++) {
    const target = sol.values[i] ?? 0
    if (target < 1 || target > 9) continue
    const cur = s.values[i] ?? 0
    if (cur !== target) return { index: i, from: cur, to: target }
  }
  return null
}
