/**
 * 数和（Kakuro）—— 实时校验
 *
 * 校验粒度是「段」：
 *   - 段内重复数字；
 *   - 段内数字和超过提示（再也填不对）；
 *   - 段已填满但和不足；
 *   - 剩余空格在数字不重复前提下无法凑出提示和（提前发现死路）；
 *   - 题面本身缺提示 / 段长超限。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types.ts'
import { getModel, maxSumDistinct, minSumDistinct, segmentFill } from './rules.ts'
import { asKakuroPuzzle, asKakuroState, type KakuroResult } from './types.ts'

export function validate(state: GameState, puzzle: Puzzle): KakuroResult {
  const p = asKakuroPuzzle(puzzle)
  const s = asKakuroState(state)
  const model = getModel(p)
  const values = s.values
  const badCells = new Set<number>()
  const badSegments: number[] = []
  const duplicateSegments: number[] = []
  const overSegments: number[] = []
  const shortSegments: number[] = []
  const impossibleSegments: number[] = []
  const missingClueSegments: number[] = []

  let empty = 0
  for (const i of model.white) {
    if (!(values[i]! >= 1 && values[i]! <= 9)) empty++
  }

  for (const seg of model.segments) {
    const f = segmentFill(seg, values)
    let bad = false
    if (seg.clue <= 0) {
      missingClueSegments.push(seg.id)
      bad = true
    } else if (f.duplicate || !f.valid) {
      duplicateSegments.push(seg.id)
      bad = true
    } else {
      const need = seg.clue - f.filledSum
      if (need < 0) {
        overSegments.push(seg.id)
        bad = true
      } else if (f.empties.length === 0) {
        if (need !== 0) {
          shortSegments.push(seg.id)
          bad = true
        }
      } else {
        const rest = f.empties.length
        if (need < minSumDistinct(rest, f.usedMask) || need > maxSumDistinct(rest, f.usedMask)) {
          impossibleSegments.push(seg.id)
          bad = true
        }
      }
    }
    if (bad) {
      badSegments.push(seg.id)
      // 重复时只高亮重复的格子；其余错误整段高亮
      if (f.duplicate) {
        const seen = new Set<number>()
        for (const cell of seg.cells) {
          const v = values[cell] ?? 0
          if (v <= 0) continue
          if (seen.has(v)) badCells.add(cell)
          seen.add(v)
        }
        // 第一次出现的同值也要标出来，让用户看到冲突对
        const counts = new Map<number, number[]>()
        for (const cell of seg.cells) {
          const v = values[cell] ?? 0
          if (v <= 0) continue
          const list = counts.get(v) ?? []
          list.push(cell)
          counts.set(v, list)
        }
        for (const list of counts.values()) {
          if (list.length > 1) for (const cell of list) badCells.add(cell)
        }
      } else {
        for (const cell of seg.cells) badCells.add(cell)
      }
    }
  }

  // 题面结构问题：整盘提示（避免「无解」被误认为玩家填错）
  if (model.issues.length > 0) {
    for (const i of model.white) badCells.add(i)
  }

  const issueCount = badSegments.length + model.issues.length
  const complete = empty === 0
  const solved = complete && issueCount === 0 && model.issues.length === 0

  return {
    solved,
    empty,
    totalWhite: model.white.length,
    complete,
    badCells: [...badCells],
    badSegments,
    duplicateSegments,
    overSegments,
    shortSegments,
    impossibleSegments,
    missingClueSegments,
    issueCount,
  }
}

export function statusBits(result: ValidationResult): string[] {
  const r = result as KakuroResult
  if (r.solved) return ['完成！每一段的和与数字都不重复']
  const bits: string[] = []
  if (typeof r.totalWhite === 'number' && typeof r.empty === 'number') {
    bits.push(`已填 ${r.totalWhite - r.empty}/${r.totalWhite} 格`)
  }
  if (r.missingClueSegments?.length) bits.push(`题面缺 ${r.missingClueSegments.length} 个提示`)
  if (r.duplicateSegments?.length) bits.push(`${r.duplicateSegments.length} 段数字重复`)
  if (r.overSegments?.length) bits.push(`${r.overSegments.length} 段和超限`)
  if (r.shortSegments?.length) bits.push(`${r.shortSegments.length} 段和不足`)
  if (r.impossibleSegments?.length) bits.push(`${r.impossibleSegments.length} 段已无法凑出提示和`)
  if (bits.length === 0) bits.push('盘面合法，继续填数')
  return bits
}
