/**
 * 数和（Kakuro）—— 内置题库
 *
 * 题库由 scripts/gen-puzzles.mjs 生成到 puzzles-data.ts，
 * 每道题都经过「唯一解 + 逻辑规则可推满」校验。
 */

import type { GameState, Puzzle } from '../core/types.ts'
import { decodeRawPuzzle, decodeSolution } from './rules.ts'
import { RAW_PUZZLES } from './puzzles-data.ts'
import { IMPORTED_PUZZLES } from './imported-puzzles.ts'
import { asKakuroPuzzle, type KakuroPuzzle, type KakuroState, type RawKakuroPuzzle } from './types.ts'

// 内置题 + 图片识别导入题（imported-puzzles.ts 由 scripts/import-image.mjs --append 写入）
const RAW = [...RAW_PUZZLES, ...IMPORTED_PUZZLES] as RawKakuroPuzzle[]

const decoded = new Map<string, KakuroPuzzle>()
for (const raw of RAW) {
  const p = decodeRawPuzzle(raw)
  if (p) decoded.set(p.id, p)
}

export const builtinPuzzles: Puzzle[] = [...decoded.values()]

export function getReferenceSolution(id: string): GameState | null {
  const raw = RAW.find((p) => p.id === id)
  const puzzle = decoded.get(id)
  if (!raw || !puzzle) return null
  const values = typeof raw.solution === 'string' && raw.solution
    ? decodeSolution(raw.solution, puzzle.width * puzzle.height)
    : null
  if (!values) return null
  const kp = asKakuroPuzzle(puzzle)
  const state: KakuroState = {
    puzzleId: kp.id,
    width: kp.width,
    height: kp.height,
    values,
  }
  return state
}
