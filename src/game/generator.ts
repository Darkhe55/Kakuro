/**
 * 数和（Kakuro）—— 内置题库生成器
 *
 * 生成流程（可复现，固定随机种子）：
 *   1. 随机黑格布局（第一行 / 第一列必须全黑，保证每个白格都有提示黑格）；
 *   2. 用回溯填出一组「每段数字不重复」的完整解；
 *   3. 由解反推每格的横向 / 纵向提示和；
 *   4. 用求解器验证唯一解（找到 2 个解就丢弃）；
 *   5. 用逻辑规则引擎验证「可以纯逻辑推完」（推不完就丢弃）。
 *
 * 只有同时满足 4 + 5 的题面才会进入题库。
 */

import { planLogicSolve } from './logic.ts'
import { computeClues, encodeBoard, encodeSolution, getModel } from './rules.ts'
import { countSolutions } from './solver.ts'
import type { KakuroPuzzle, KakuroState, RawKakuroPuzzle } from './types.ts'

/* ────────────────────────────── 随机数 ────────────────────────────── */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(rng: () => number, list: T[]): T[] {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/* ────────────────────────────── 布局 ────────────────────────────── */

function randomLayout(rng: () => number, width: number, height: number, blockProb: number): number[] {
  const blocks = new Array<number>(width * height).fill(0)
  for (let x = 0; x < width; x++) blocks[x] = 1
  for (let y = 0; y < height; y++) blocks[y * width] = 1
  for (let y = 1; y < height; y++) {
    for (let x = 1; x < width; x++) {
      if (rng() < blockProb) blocks[y * width + x] = 1
    }
  }
  // 至少要有足够多的白格，否则题目退化成一片黑
  let white = 0
  for (const b of blocks) if (!b) white++
  if (white < Math.max(6, Math.floor((width * height) / 4))) return []
  return blocks
}

/* ────────────────────────────── 随机完成解 ────────────────────────────── */

function randomSolution(
  rng: () => number,
  blocks: number[],
  width: number,
  height: number,
): number[] | null {
  const size = width * height
  const values = new Array<number>(size).fill(0)
  // 按行优先顺序填写：填某格时只需检查左侧、上侧已填邻格（右侧/下侧稍后才填）
  const order: number[] = []
  for (let i = 0; i < size; i++) if (!blocks[i]) order.push(i)
  let nodes = 0

  const usedMask = (index: number): number => {
    const x = index % width
    const y = Math.floor(index / width)
    let mask = 0
    for (let k = x - 1; k >= 0 && !blocks[y * width + k]; k--) {
      const v = values[y * width + k]!
      if (v) mask |= 1 << v
    }
    for (let k = y - 1; k >= 0 && !blocks[k * width + x]; k--) {
      const v = values[k * width + x]!
      if (v) mask |= 1 << v
    }
    return mask
  }

  const dfs = (pos: number): boolean => {
    if (pos >= order.length) return true
    if (++nodes > 200_000) return false
    const index = order[pos]!
    const mask = usedMask(index)
    const digits = shuffle(rng, [1, 2, 3, 4, 5, 6, 7, 8, 9]).filter((d) => !(mask & (1 << d)))
    for (const d of digits) {
      values[index] = d
      if (dfs(pos + 1)) return true
      values[index] = 0
    }
    return false
  }

  return dfs(0) ? values : null
}

/* ────────────────────────────── 校验 ────────────────────────────── */

function logicComplete(puzzle: KakuroPuzzle): number {
  const model = getModel(puzzle)
  const emptyState: KakuroState = {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    values: new Array<number>(puzzle.width * puzzle.height).fill(0),
  }
  const plan = planLogicSolve(puzzle, emptyState)
  if (!plan.saturated || !plan.finalState) return -1
  const values = (plan.finalState as KakuroState).values
  for (const i of model.white) {
    if (!(values[i]! >= 1 && values[i]! <= 9)) return -1
  }
  return plan.frames.length
}

/* ────────────────────────────── 主流程 ────────────────────────────── */

interface Target {
  width: number
  height: number
  difficulty: 'easy' | 'medium' | 'hard'
  /** 黑格密度候选（从低到高；低密度找不到唯一解时自动加密度重试） */
  densities: number[]
  minWhite: number
  name: string
  maxAttempts: number
}

const TARGETS: Target[] = [
  { width: 5, height: 5, difficulty: 'easy', densities: [0.22, 0.28, 0.34], minWhite: 9, name: '初识数和', maxAttempts: 1500 },
  { width: 6, height: 6, difficulty: 'easy', densities: [0.25, 0.3, 0.36], minWhite: 13, name: '六宫小径', maxAttempts: 1800 },
  { width: 7, height: 7, difficulty: 'easy', densities: [0.26, 0.31, 0.37], minWhite: 18, name: '七步成章', maxAttempts: 2200 },
  { width: 6, height: 8, difficulty: 'medium', densities: [0.28, 0.34, 0.4], minWhite: 18, name: '纵横交错', maxAttempts: 2400 },
  { width: 8, height: 8, difficulty: 'medium', densities: [0.3, 0.36, 0.42], minWhite: 24, name: '八面玲珑', maxAttempts: 2400 },
  { width: 9, height: 9, difficulty: 'medium', densities: [0.33, 0.39, 0.45], minWhite: 30, name: '九九归一', maxAttempts: 2800 },
  { width: 8, height: 10, difficulty: 'hard', densities: [0.32, 0.38, 0.44], minWhite: 30, name: '抽丝剥茧', maxAttempts: 3000 },
  { width: 10, height: 10, difficulty: 'hard', densities: [0.36, 0.42, 0.48], minWhite: 38, name: '巅峰挑战', maxAttempts: 3000 },
]

export function generatePuzzles(seed = 20251115): RawKakuroPuzzle[] {
  const rng = mulberry32(seed)
  const out: RawKakuroPuzzle[] = []
  let serial = 0
  for (const target of TARGETS) {
    const { width, height } = target
    let found = false
    for (const blockProb of target.densities) {
      for (let attempt = 0; attempt < target.maxAttempts && !found; attempt++) {
        const blocks = randomLayout(rng, width, height, blockProb)
        if (!blocks.length) continue
        const solution = randomSolution(rng, blocks, width, height)
        if (!solution) continue
        const { hClues, vClues } = computeClues(blocks, solution, width, height)
        const id = `kakuro-${width}x${height}-${serial}`
        const puzzle: KakuroPuzzle = {
          id,
          name: `${target.name} ${width}×${height}`,
          width,
          height,
          difficulty: target.difficulty,
          blocks,
          hClues,
          vClues,
          solution,
        }
        const model = getModel(puzzle)
        if (model.issues.length > 0) continue
        if (model.white.length < target.minWhite) continue
        const counted = countSolutions(puzzle, 2, 220_000, 2500)
        if (counted.timedOut || counted.count !== 1) continue
        if (logicComplete(puzzle) < 0) continue
        out.push({
          id,
          name: puzzle.name,
          width,
          height,
          difficulty: target.difficulty,
          series: 'builtin',
          board: encodeBoard(puzzle),
          solution: encodeSolution(puzzle, solution),
        })
        serial++
        found = true
      }
      if (found) break
      console.log(`[gen] ${width}×${height} 密度 ${blockProb} 未命中，提高黑格密度重试…`)
    }
    if (!found) {
      console.warn(`[gen] ${width}×${height} 没有找到唯一解 + 逻辑可解的题面`)
    }
  }
  return out
}
