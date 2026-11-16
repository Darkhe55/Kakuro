/**
 * 数和（Kakuro）—— 题面规则与几何模型
 *
 * 负责：
 *   - 从题面解析出「黑格布局 / 横纵提示 / 连续白格段」；
 *   - 段和、候选数字集合、可能的和区间等纯规则工具；
 *   - 题面编码 / 解码（puzzles-data.ts 与自定义题板共用）。
 */

import type { KakuroModel, KakuroPuzzle, KakuroSegment, RawKakuroPuzzle } from './types.ts'

export type { KakuroModel, KakuroPuzzle, KakuroSegment } from './types.ts'

/** 数和允许的最大盘面尺寸（自定义题板上限） */
export const MAX_SIZE = 20
/** 内置题 / 图片识别导入题的盘面上限（导入的真实题图可能远大于自定义题板上限） */
export const MAX_BOARD_SIZE = 64
/** 单段最长 9 格（数字 1..9 不重复） */
export const MAX_RUN = 9

export const ALL_DIGITS_MASK = 0b1111111110 // 位 1..9

const modelCache = new WeakMap<KakuroPuzzle, KakuroModel>()

function n0(value: unknown, size: number): number[] {
  const out = new Array<number>(size).fill(0)
  if (!Array.isArray(value)) return out
  for (let i = 0; i < size && i < value.length; i++) {
    const v = Number(value[i])
    out[i] = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
  }
  return out
}

function blocksOf(p: KakuroPuzzle, size: number): number[] {
  const out = new Array<number>(size).fill(0)
  if (!Array.isArray(p.blocks)) return out
  for (let i = 0; i < size && i < p.blocks.length; i++) out[i] = p.blocks[i] ? 1 : 0
  return out
}

/** 从题面构建完整模型（带缓存） */
export function getModel(p: KakuroPuzzle): KakuroModel {
  const cached = modelCache.get(p)
  if (cached) return cached
  const model = buildModel(p)
  modelCache.set(p, model)
  return model
}

/** 清空模型缓存（自定义题板修改题面后如复用对象可调用） */
export function invalidateModel(p: KakuroPuzzle): void {
  modelCache.delete(p)
}

export function buildModel(p: KakuroPuzzle): KakuroModel {
  const width = Math.max(2, Math.min(MAX_BOARD_SIZE, Math.floor(p.width) || 0))
  const height = Math.max(2, Math.min(MAX_BOARD_SIZE, Math.floor(p.height) || 0))
  const size = width * height
  const blocks = blocksOf(p, size)
  const hClues = n0(p.hClues, size)
  const vClues = n0(p.vClues, size)
  const hSeg = new Array<number>(size).fill(-1)
  const vSeg = new Array<number>(size).fill(-1)
  const white: number[] = []
  const segments: KakuroSegment[] = []
  const issues: string[] = []

  for (let i = 0; i < size; i++) if (!blocks[i]) white.push(i)

  const addSegment = (dir: 'h' | 'v', clueCell: number, cells: number[], clue: number): void => {
    const id = segments.length
    const seg: KakuroSegment = { id, dir, clue, cells, clueCell }
    segments.push(seg)
    const target = dir === 'h' ? hSeg : vSeg
    for (const cell of cells) target[cell] = id
  }

  // 每个黑格向右 / 向下开段
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!blocks[i]) continue
      if (x + 1 < width && !blocks[i + 1]) {
        const cells: number[] = []
        for (let k = x + 1; k < width && !blocks[y * width + k]; k++) cells.push(y * width + k)
        if (cells.length > MAX_RUN) {
          issues.push(`第 ${y + 1} 行第 ${x + 2} 列起的横向段长 ${cells.length}，超过 ${MAX_RUN}`)
        }
        if (hClues[i] <= 0) {
          issues.push(`第 ${y + 1} 行第 ${x + 1} 列黑格缺少横向提示和`)
        }
        addSegment('h', i, cells, hClues[i])
      }
      if (y + 1 < height && !blocks[i + width]) {
        const cells: number[] = []
        for (let k = y + 1; k < height && !blocks[k * width + x]; k++) cells.push(k * width + x)
        if (cells.length > MAX_RUN) {
          issues.push(`第 ${y + 2} 行第 ${x + 1} 列起的纵向段长 ${cells.length}，超过 ${MAX_RUN}`)
        }
        if (vClues[i] <= 0) {
          issues.push(`第 ${y + 1} 行第 ${x + 1} 列黑格缺少纵向提示和`)
        }
        addSegment('v', i, cells, vClues[i])
      }
    }
  }

  // 每个白格都必须同时属于一个横向段和一个纵向段
  for (const i of white) {
    if (hSeg[i] < 0) issues.push(`第 ${Math.floor(i / width) + 1} 行第 ${(i % width) + 1} 列白格左侧没有提示黑格`)
    if (vSeg[i] < 0) issues.push(`第 ${Math.floor(i / width) + 1} 行第 ${(i % width) + 1} 列白格上方没有提示黑格`)
  }

  // 提示和必须落在该段长度的可能区间内
  for (const seg of segments) {
    if (seg.clue <= 0) continue
    if (seg.cells.length > MAX_RUN) continue
    const { min, max } = clueRange(seg.cells.length)
    if (seg.clue < min || seg.clue > max) {
      issues.push(
        `第 ${Math.floor(seg.clueCell / width) + 1} 行第 ${(seg.clueCell % width) + 1} 列提示 ${seg.clue} 不在 ${seg.cells.length} 格的可能区间 ${min}..${max}`,
      )
    }
  }

  return { puzzle: p, width, height, size, white, segments, hSeg, vSeg, issues }
}

/** 长度为 len 的不重复数字之和的取值区间 */
export function clueRange(len: number): { min: number; max: number } {
  if (len <= 0) return { min: 0, max: 0 }
  const k = Math.min(len, MAX_RUN)
  return { min: (k * (k + 1)) / 2, max: (k * (2 * MAX_RUN - k + 1)) / 2 }
}

/** 从可用数字中取 count 个的最小和（usedMask 已占用的数字不可用） */
export function minSumDistinct(count: number, usedMask = 0): number {
  if (count <= 0) return 0
  let sum = 0
  let taken = 0
  for (let d = 1; d <= 9 && taken < count; d++) {
    if (usedMask & (1 << d)) continue
    sum += d
    taken++
  }
  return taken === count ? sum : Infinity
}

/** 从可用数字中取 count 个的最大和 */
export function maxSumDistinct(count: number, usedMask = 0): number {
  if (count <= 0) return 0
  let sum = 0
  let taken = 0
  for (let d = 9; d >= 1 && taken < count; d--) {
    if (usedMask & (1 << d)) continue
    sum += d
    taken++
  }
  return taken === count ? sum : -Infinity
}

/** 段内已填情况 */
export interface SegmentFill {
  cells: number[]
  empties: number[]
  usedMask: number
  filledSum: number
  /** 已填数字有重复 */
  duplicate: boolean
  /** 已填数字是否都在 1..9（数据清洗用） */
  valid: boolean
}

export function segmentFill(seg: KakuroSegment, values: ArrayLike<number>): SegmentFill {
  const empties: number[] = []
  let usedMask = 0
  let filledSum = 0
  let duplicate = false
  let valid = true
  for (const cell of seg.cells) {
    const raw = values[cell] ?? 0
    const v = Math.floor(raw)
    if (v <= 0) {
      empties.push(cell)
      continue
    }
    if (v > 9) valid = false
    const bit = 1 << Math.min(v, 9)
    if (usedMask & bit) duplicate = true
    usedMask |= bit
    filledSum += Math.min(v, 9)
  }
  return { cells: seg.cells, empties, usedMask, filledSum, duplicate, valid }
}

/** 段是否还有可能凑出提示和（数字不重复前提下） */
export function segmentViable(seg: KakuroSegment, values: ArrayLike<number>): boolean {
  const f = segmentFill(seg, values)
  if (f.duplicate || !f.valid) return false
  const need = seg.clue - f.filledSum
  if (f.empties.length === 0) return need === 0
  if (seg.clue <= 0) return false
  return need >= minSumDistinct(f.empties.length, f.usedMask) && need <= maxSumDistinct(f.empties.length, f.usedMask)
}

/**
 * 枚举某段所有可行的补全方案（按段内空格顺序给出数字）。
 *
 * cands 可选：每格可用数字位掩码（下标为格子索引），用于逻辑推演时叠加全局候选。
 * maxCount 用于调用方限制枚举数量；超过时生成器停止产出，调用方应把该段视为「组合过多」跳过。
 */
export function* segmentAssignments(
  seg: KakuroSegment,
  values: ArrayLike<number>,
  cands?: ArrayLike<number>,
): Generator<number[]> {
  const f = segmentFill(seg, values)
  const need = seg.clue - f.filledSum
  if (!f.valid || f.duplicate || seg.clue <= 0) return
  const empties = f.empties
  const len = empties.length
  if (len === 0) {
    if (need === 0) yield []
    return
  }
  if (need < minSumDistinct(len, f.usedMask) || need > maxSumDistinct(len, f.usedMask)) return

  const out = new Array<number>(len).fill(0)
  const walk = function* (pos: number, needLeft: number, mask: number): Generator<number[]> {
    if (pos === len) {
      if (needLeft === 0) yield out.slice()
      return
    }
    const rest = len - pos - 1
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << d
      if (mask & bit) continue
      if (cands && !((cands[empties[pos]!] ?? ALL_DIGITS_MASK) & bit)) continue
      const nextNeed = needLeft - d
      const nextMask = mask | bit
      if (rest > 0) {
        if (nextNeed < minSumDistinct(rest, nextMask) || nextNeed > maxSumDistinct(rest, nextMask)) continue
      } else if (nextNeed !== 0) {
        continue
      }
      out[pos] = d
      yield* walk(pos + 1, nextNeed, nextMask)
    }
  }
  yield* walk(0, need, f.usedMask)
}

/** 段内是否已经满足（填满、不重复、和正确） */
export function segmentSatisfied(seg: KakuroSegment, values: ArrayLike<number>): boolean {
  const f = segmentFill(seg, values)
  if (f.empties.length > 0 || f.duplicate || !f.valid) return false
  return f.filledSum === seg.clue && seg.clue > 0
}

/* ────────────────────────────── 编解码 ────────────────────────────── */

/**
 * 题面编码：
 *   行与行用 "/" 分隔，格与格用 "," 分隔；
 *   白格写作 "."，黑格写作 "横提示.纵提示"（0 表示该方向无提示）。
 *   例如 5×5 全黑首行： "0.0,0.0,0.0,0.0,0.0/..."
 */
export function encodeBoard(p: KakuroPuzzle): string {
  const { width, height, size } = { width: p.width, height: p.height, size: p.width * p.height }
  const blocks = blocksOf(p, size)
  const h = n0(p.hClues, size)
  const v = n0(p.vClues, size)
  const rows: string[] = []
  for (let y = 0; y < height; y++) {
    const cells: string[] = []
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      cells.push(blocks[i] ? `${h[i]}.${v[i]}` : '.')
    }
    rows.push(cells.join(','))
  }
  return rows.join('/')
}

export interface DecodedBoard {
  width: number
  height: number
  blocks: number[]
  hClues: number[]
  vClues: number[]
}

export function decodeBoard(text: string, width?: number, height?: number, maxSize = MAX_SIZE): DecodedBoard | null {
  if (typeof text !== 'string' || !text.trim()) return null
  const rows = text.split('/')
  const h = height ?? rows.length
  const w = width ?? (rows[0] ? rows[0].split(',').length : 0)
  if (w < 2 || h < 2 || w > maxSize || h > maxSize) return null
  if (rows.length !== h) return null
  const size = w * h
  const blocks = new Array<number>(size).fill(0)
  const hClues = new Array<number>(size).fill(0)
  const vClues = new Array<number>(size).fill(0)
  for (let y = 0; y < h; y++) {
    const cells = (rows[y] ?? '').split(',')
    if (cells.length !== w) return null
    for (let x = 0; x < w; x++) {
      const token = cells[x]!.trim()
      const i = y * w + x
      if (token === '.' || token === '_' || token === '') {
        blocks[i] = 0
        continue
      }
      const parts = token.split('.')
      if (parts.length !== 2) return null
      const hc = Number(parts[0])
      const vc = Number(parts[1])
      if (!Number.isInteger(hc) || !Number.isInteger(vc) || hc < 0 || hc > 45 || vc < 0 || vc > 45) {
        return null
      }
      blocks[i] = 1
      hClues[i] = hc
      vClues[i] = vc
    }
  }
  return { width: w, height: h, blocks, hClues, vClues }
}

/** 参考解编码：白格写 1..9，黑格写 0 */
export function encodeSolution(p: KakuroPuzzle, values: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < p.width * p.height; i++) {
    const v = Math.floor(values[i] ?? 0)
    out += v >= 1 && v <= 9 ? String(v) : '0'
  }
  return out
}

export function decodeSolution(text: string, size: number): number[] | null {
  if (typeof text !== 'string' || text.length !== size) return null
  const out = new Array<number>(size).fill(0)
  for (let i = 0; i < size; i++) {
    const ch = text[i]!
    if (ch === '.' || ch === '0' || ch === '_') {
      out[i] = 0
      continue
    }
    const d = ch.charCodeAt(0) - 48
    if (d < 1 || d > 9) return null
    out[i] = d
  }
  return out
}

/** 由完整解（黑格 0）反推每格提示和 */
export function computeClues(
  blocks: ArrayLike<number>,
  solution: ArrayLike<number>,
  width: number,
  height: number,
): { hClues: number[]; vClues: number[] } {
  const size = width * height
  const hClues = new Array<number>(size).fill(0)
  const vClues = new Array<number>(size).fill(0)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!blocks[i]) continue
      if (x + 1 < width && !blocks[i + 1]) {
        let sum = 0
        for (let k = x + 1; k < width && !blocks[y * width + k]; k++) sum += solution[y * width + k] ?? 0
        hClues[i] = sum
      }
      if (y + 1 < height && !blocks[i + width]) {
        let sum = 0
        for (let k = y + 1; k < height && !blocks[k * width + x]; k++) sum += solution[k * width + x] ?? 0
        vClues[i] = sum
      }
    }
  }
  return { hClues, vClues }
}

/** 由原始条目解码题面 */
export function decodeRawPuzzle(raw: RawKakuroPuzzle): KakuroPuzzle | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null
  if (!Number.isInteger(raw.width) || !Number.isInteger(raw.height)) return null
  if (raw.width < 2 || raw.height < 2 || raw.width > MAX_BOARD_SIZE || raw.height > MAX_BOARD_SIZE) return null
  const board = decodeBoard(raw.board, raw.width, raw.height, MAX_BOARD_SIZE)
  if (!board) return null
  const solution = typeof raw.solution === 'string' && raw.solution.length > 0
    ? decodeSolution(raw.solution, raw.width * raw.height)
    : null
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : `数和 ${raw.width}×${raw.height}`,
    width: raw.width,
    height: raw.height,
    difficulty: raw.difficulty ?? 'medium',
    blocks: board.blocks,
    hClues: board.hClues,
    vClues: board.vClues,
    solution: solution ?? undefined,
  }
}
