/**
 * 数和（Kakuro）—— 逻辑解题回放计划
 *
 * 规则引擎（全部是「可证明」的排除，不做猜测）：
 *   1. 唯一候选：某格候选只剩一个数字；
 *   2. 段和约束：枚举该段所有可能的数字组合，
 *      · 某格在所有组合里都只能是同一个数字 → 落子；
 *      · 某数字在所有组合里都出现、且只能放在唯一一格 → 落子；
 *   3. 反证排除：假设某格填 d 后继续传播会立刻矛盾 → 排除 d，
 *      若只剩一个数字则落子。
 *
 * 回放帧只包含「落子」（PlaybackFrame.move），排除过程计入 ruleSteps。
 */

import type { GameState, LogicPlan, PlaybackFrame, Puzzle } from '../core/types.ts'
import { ALL_DIGITS_MASK, getModel, segmentFill, type KakuroModel, type KakuroSegment } from './rules.ts'
import { asKakuroPuzzle, asKakuroState, type KakuroState } from './types.ts'

const RULE_LABEL = {
  1: '唯一候选：该格只剩一个数字',
  2: '段和约束：组合排除后该数字被确定',
  3: '反证排除：其余数字都会立刻矛盾',
} as const

function popcount(mask: number): number {
  let n = 0
  let m = mask
  while (m) {
    m &= m - 1
    n++
  }
  return n
}

function digitOf(mask: number): number {
  for (let d = 1; d <= 9; d++) if (mask & (1 << d)) return d
  return 0
}

/** 枚举「count 个不重复数字、和为 need」的数字集合（升序去重） */
function collectDigitSets(
  count: number,
  need: number,
  usedMask: number,
  out: number[][],
  cap: number,
): void {
  const path: number[] = []
  const walk = (pos: number, start: number, needLeft: number, mask: number): void => {
    if (out.length >= cap) return
    if (pos === count) {
      if (needLeft === 0) out.push(path.slice())
      return
    }
    const rest = count - pos - 1
    for (let d = start; d <= 9; d++) {
      const bit = 1 << d
      if (mask & bit) continue
      if (d > needLeft) break
      const nextNeed = needLeft - d
      if (rest > 0) {
        let min = 0
        let taken = 0
        for (let x = d + 1; x <= 9 && taken < rest; x++) {
          if (mask & (1 << x)) continue
          min += x
          taken++
        }
        if (taken < rest || nextNeed < min) continue
      } else if (nextNeed !== 0) {
        continue
      }
      path.push(d)
      walk(pos + 1, d + 1, nextNeed, mask | bit)
      path.pop()
      if (out.length >= cap) return
    }
  }
  walk(0, 1, need, usedMask)
}

interface SegmentAnalysis {
  ok: boolean
  /** 每格在所有可能组合中的数字并集（下标对应 empties） */
  union: number[]
  /** 组合数量 */
  setCount: number
  /** 被所有组合确定位置的数字 */
  forced: Array<{ cell: number; digit: number }>
  empties: number[]
}

const SET_CAP = 2000
const POS_MASK = 0xffff

function analyzeSegment(
  seg: KakuroSegment,
  values: ArrayLike<number>,
  cands: ArrayLike<number>,
): SegmentAnalysis {
  const f = segmentFill(seg, values)
  const empty = { ok: true, union: [] as number[], setCount: 0, forced: [] as Array<{ cell: number; digit: number }>, empties: f.empties }
  if (seg.clue <= 0) return { ...empty, ok: false }
  if (f.duplicate || !f.valid) return { ...empty, ok: false }
  const need = seg.clue - f.filledSum
  if (f.empties.length === 0) return need === 0 ? empty : { ...empty, ok: false }
  if (need < 0) return { ...empty, ok: false }

  const sets: number[][] = []
  collectDigitSets(f.empties.length, need, f.usedMask, sets, SET_CAP)
  if (sets.length === 0) return { ...empty, ok: false }

  const len = f.empties.length
  const union = new Array<number>(len).fill(0)
  const present = new Array<number>(10).fill(0)
  const posIntersect = new Array<number>(10).fill(POS_MASK)
  const positionsForDigit = new Array<number>(10).fill(0)

  let usedSets = 0
  for (const set of sets) {
    // 必要条件：每个数字至少能放进段内某一格
    let placeable = true
    for (const d of set) {
      let possible = 0
      for (let p = 0; p < len; p++) {
        if (cands[f.empties[p]!]! & (1 << d)) possible |= 1 << p
      }
      if (!possible) {
        placeable = false
        break
      }
      positionsForDigit[d] = possible
    }
    if (!placeable) continue
    usedSets++
    for (let p = 0; p < len; p++) {
      const cell = f.empties[p]!
      const allow = cands[cell]!
      for (const d of set) if (allow & (1 << d)) union[p]! |= 1 << d
    }
    for (const d of set) {
      present[d]!++
      posIntersect[d]! &= positionsForDigit[d]!
    }
  }
  if (usedSets === 0) return { ...empty, ok: false }

  const forced: Array<{ cell: number; digit: number }> = []
  for (let d = 1; d <= 9; d++) {
    if (present[d] !== usedSets) continue
    const pos = posIntersect[d]!
    if (popcount(pos) === 1) {
      let p = 0
      while (((pos >> p) & 1) === 0) p++
      forced.push({ cell: f.empties[p]!, digit: d })
    }
  }

  // 每格并集为空 → 矛盾
  for (let p = 0; p < len; p++) {
    if (union[p] === 0) return { ...empty, ok: false }
  }
  return { ok: true, union, setCount: usedSets, forced, empties: f.empties }
}

/** 候选传播：反复用段组合裁剪候选，返回 false = 矛盾 */
function propagateCandidates(
  values: ArrayLike<number>,
  cands: number[],
  model: KakuroModel,
  maxRounds = 80,
): boolean {
  for (let round = 0; round < maxRounds; round++) {
    let changed = false
    for (const seg of model.segments) {
      const analysis = analyzeSegment(seg, values, cands)
      if (!analysis.ok) return false
      for (let p = 0; p < analysis.empties.length; p++) {
        const cell = analysis.empties[p]!
        const next = (cands[cell] ?? ALL_DIGITS_MASK) & analysis.union[p]!
        if (next === 0) return false
        if (next !== cands[cell]) {
          cands[cell] = next
          changed = true
        }
      }
      for (const { cell, digit } of analysis.forced) {
        const next = cands[cell]! & (1 << digit)
        if (next === 0) return false
        if (next !== cands[cell]) {
          cands[cell] = next
          changed = true
        }
      }
    }
    if (!changed) return true
  }
  return true
}

interface ProbeResult {
  contradiction: boolean
  placements: Array<{ index: number; value: number }>
}

/** 反证排除：对候选数最少的若干格逐个试数，排除会立刻矛盾的数字 */
function probeRound(
  values: number[],
  cands: number[],
  model: KakuroModel,
  budget: { left: number },
): ProbeResult {
  const cells: Array<{ index: number; count: number }> = []
  for (const i of model.white) {
    if (values[i]! >= 1) continue
    const count = popcount(cands[i]!)
    if (count <= 1) continue
    cells.push({ index: i, count })
  }
  cells.sort((a, b) => a.count - b.count)
  const picks = cells.slice(0, 6)
  const placements: Array<{ index: number; value: number }> = []
  for (const { index } of picks) {
    if (budget.left <= 0) break
    budget.left--
    const bits = cands[index]!
    let possible = 0
    for (let d = 1; d <= 9; d++) {
      if (!(bits & (1 << d))) continue
      const testCands = cands.slice()
      testCands[index] = 1 << d
      const testValues = values.slice()
      if (propagateCandidates(testValues, testCands, model, 24)) possible |= 1 << d
    }
    if (possible === 0) return { contradiction: true, placements: [] }
    if (possible !== bits) {
      cands[index] = possible
      if (popcount(possible) === 1) placements.push({ index, value: digitOf(possible) })
    }
  }
  return { contradiction: false, placements }
}

export function planLogicSolve(puzzle: Puzzle, initialState: GameState): LogicPlan {
  const p = asKakuroPuzzle(puzzle)
  const s = asKakuroState(initialState)
  const model = getModel(p)
  const emptyPlan: LogicPlan = {
    puzzleId: p.id,
    frames: [],
    finalState: null,
    ruleSteps: 0,
    saturated: false,
  }
  if (model.issues.length > 0) return emptyPlan

  const values = new Array<number>(model.size).fill(0)
  for (const i of model.white) {
    const v = Math.floor(s.values?.[i] ?? 0)
    values[i] = v >= 1 && v <= 9 ? v : 0
  }
  const cands = new Array<number>(model.size).fill(0)
  for (const i of model.white) cands[i] = values[i]! >= 1 ? 1 << values[i]! : ALL_DIGITS_MASK

  const frames: PlaybackFrame[] = []
  let lastRule = 0
  let streak = 0
  const emit = (index: number, to: number, rule: 1 | 2 | 3): void => {
    if (values[index] === to) return
    const from = values[index] ?? 0
    values[index] = to
    cands[index] = 1 << to
    if (rule === lastRule) streak++
    else {
      lastRule = rule
      streak = 1
    }
    frames.push({ rule, label: RULE_LABEL[rule], move: { index, from, to }, streak })
  }

  let rounds = 0
  let saturated = false
  let contradiction = false
  const probeBudget = { left: 60 }

  while (rounds < 400) {
    rounds++
    const before = cands.slice()
    if (!propagateCandidates(values, cands, model)) {
      contradiction = true
      break
    }
    const placements: Array<{ index: number; value: number; rule: 1 | 2 }> = []
    for (const i of model.white) {
      if (values[i]! >= 1) continue
      const bits = cands[i]!
      if (popcount(bits) === 1) {
        placements.push({ index: i, value: digitOf(bits), rule: popcount(before[i]!) === 1 ? 1 : 2 })
      }
    }
    if (placements.length > 0) {
      for (const { index, value, rule } of placements) emit(index, value, rule)
      continue
    }

    let filled = true
    for (const i of model.white) {
      if (values[i]! < 1) {
        filled = false
        break
      }
    }
    if (filled) {
      saturated = true
      break
    }
    if (probeBudget.left <= 0) break

    // 卡住时用反证排除推进
    const probe = probeRound(values, cands, model, probeBudget)
    if (probe.contradiction) {
      contradiction = true
      break
    }
    if (probe.placements.length > 0) {
      for (const { index, value } of probe.placements) emit(index, value, 3)
      continue
    }
    break
  }

  const stillUnknown = model.white.some((i) => values[i]! < 1)
  if (!stillUnknown && !contradiction) saturated = true
  const finalState: KakuroState = {
    puzzleId: p.id,
    width: p.width,
    height: p.height,
    values: values.slice(),
    selected: s.selected,
  }
  return {
    puzzleId: p.id,
    frames,
    finalState,
    ruleSteps: rounds,
    saturated: saturated && !contradiction,
  }
}
