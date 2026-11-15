/**
 * 数和（Kakuro）—— 回溯求解器
 *
 * 思路：
 *   1. 以「段」为搜索单位（每个白格属于一个横段 + 一个纵段）；
 *   2. 每次选可行补全组合最少的段进行分支（MRV）；
 *   3. 枚举补全时用「剩余空格 + 已用数字」的 min/max 和区间剪枝；
 *   4. 分支前做强制传播：某段只剩一种补全时直接填入，反复到不动点；
 *   5. 带节点数与时间双预算，超限时标记 timedOut。
 *
 * 唯一解校验（自定义题板 / check.mjs）用 countSolutions(limit=2)。
 */

import type { Puzzle, SolveResult } from '../core/types.ts'
import { getModel, segmentAssignments, segmentFill, type KakuroModel } from './rules.ts'
import { makeState } from './state.ts'
import { asKakuroPuzzle } from './types.ts'

export interface SearchOutcome {
  solutions: number[][]
  nodes: number
  timedOut: boolean
}

interface Budget {
  maxNodes: number
  timeMs: number
  start: number
}

function newBudget(maxNodes: number, timeMs: number): Budget {
  return { maxNodes, timeMs, start: Date.now() }
}

/**
 * 把「只剩唯一补全」的段填掉，返回 false 表示出现矛盾。
 * 填充的格子索引会追加到 log，便于回溯时精确撤销。
 */
function propagateForced(
  values: number[],
  model: KakuroModel,
  budget: Budget,
  log: number[],
): boolean {
  let changed = true
  while (changed) {
    changed = false
    if (Date.now() - budget.start > budget.timeMs) return false
    for (const seg of model.segments) {
      const f = segmentFill(seg, values)
      if (f.empties.length === 0) {
        if (f.duplicate || !f.valid || seg.clue <= 0 || f.filledSum !== seg.clue) return false
        continue
      }
      let count = 0
      let only: number[] | null = null
      for (const assignment of segmentAssignments(seg, values)) {
        count++
        if (count === 1) only = assignment
        else break
      }
      if (count === 0) return false
      if (count === 1 && only) {
        for (let k = 0; k < f.empties.length; k++) {
          const cell = f.empties[k]!
          values[cell] = only[k]!
          log.push(cell)
        }
        changed = true
      }
    }
  }
  return true
}

function allFilled(model: KakuroModel, values: number[]): boolean {
  for (const i of model.white) {
    if (!(values[i]! >= 1 && values[i]! <= 9)) return false
  }
  return true
}

function search(puzzle: Puzzle, limit: number, maxNodes: number, timeMs: number): SearchOutcome {
  const p = asKakuroPuzzle(puzzle)
  const model = getModel(p)
  const values = new Array<number>(model.size).fill(0)
  const solutions: number[][] = []
  const budget = newBudget(maxNodes, timeMs)
  let nodes = 0
  let timedOut = false
  /** 强制传播填入的格子索引（回溯时精确撤销） */
  const forcedLog: number[] = []

  /** 用 log 长度作为检查点，递归返回时精确撤销 */
  const dfs = (): void => {
    if (solutions.length >= limit || timedOut) return
    nodes++
    if (nodes > budget.maxNodes || Date.now() - budget.start > budget.timeMs) {
      timedOut = true
      return
    }
    const logStart = forcedLog.length
    try {
      if (!propagateForced(values, model, budget, forcedLog)) return
      if (allFilled(model, values)) {
        solutions.push(values.slice())
        return
      }

      let bestSeg = -1
      let bestCount = Infinity
      let bestList: Array<{ cells: number[]; digits: number[] }> = []
      for (const seg of model.segments) {
        const f = segmentFill(seg, values)
        if (f.empties.length === 0) continue
        const list: Array<{ cells: number[]; digits: number[] }> = []
        let complete = true
        for (const digits of segmentAssignments(seg, values)) {
          list.push({ cells: f.empties, digits })
          if (list.length >= bestCount) {
            complete = false
            break
          }
        }
        if (list.length === 0) return
        // 只有完整枚举且更少时才作为分支段
        if (complete && list.length < bestCount) {
          bestCount = list.length
          bestSeg = seg.id
          bestList = list
        }
        if (bestCount === 1) break
      }
      if (bestSeg < 0) return

      for (const { cells, digits } of bestList) {
        if (solutions.length >= limit || timedOut) return
        for (let k = 0; k < cells.length; k++) values[cells[k]!] = digits[k]!
        dfs()
        for (const cell of cells) values[cell] = 0
      }
    } finally {
      for (let k = forcedLog.length - 1; k >= logStart; k--) values[forcedLog[k]!] = 0
      forcedLog.length = logStart
    }
  }

  dfs()
  return { solutions, nodes, timedOut }
}

/** 求解一道题（返回第一组解） */
export function solvePuzzle(puzzle: Puzzle, maxNodes = 1_500_000): SolveResult {
  const p = asKakuroPuzzle(puzzle)
  const model = getModel(p)
  if (model.issues.length > 0) {
    return { solved: false, solution: null, nodes: 0, timedOut: false }
  }
  const out = search(puzzle, 1, maxNodes, 12_000)
  const first = out.solutions[0]
  if (!first) {
    return { solved: false, solution: null, nodes: out.nodes, timedOut: out.timedOut }
  }
  return {
    solved: true,
    solution: makeState(puzzle, first),
    nodes: out.nodes,
    timedOut: out.timedOut,
  }
}

/** 统计解的个数（最多 limit 个），用于唯一解校验 */
export function countSolutions(
  puzzle: Puzzle,
  limit = 2,
  maxNodes = 400_000,
  timeMs = 4000,
): { count: number; nodes: number; timedOut: boolean } {
  const p = asKakuroPuzzle(puzzle)
  const model = getModel(p)
  if (model.issues.length > 0) return { count: 0, nodes: 0, timedOut: false }
  const out = search(puzzle, limit, maxNodes, timeMs)
  return { count: out.solutions.length, nodes: out.nodes, timedOut: out.timedOut }
}
