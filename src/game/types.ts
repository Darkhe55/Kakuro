/**
 * 数和（Kakuro）—— 游戏专用类型
 *
 * 题面模型：
 *   - 黑格（blocks = 1）不填数，可携带提示和；
 *   - 白格（blocks = 0）填 1..9；
 *   - 每段连续白格（横向 / 纵向）内数字不重复，和等于对应黑格上的提示数。
 *
 * 提示位置约定（按需求）：横向提示写在黑格左上角，纵向提示写在右下角。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types.ts'

/** 数和题面 */
export interface KakuroPuzzle extends Puzzle {
  /** 每格：1 = 黑格，0 = 白格 */
  blocks: number[]
  /** 每格横向提示和：0 = 无提示，1..45 = 该行右侧白格段的和 */
  hClues: number[]
  /** 每格纵向提示和：0 = 无提示，1..45 = 该列下方白格段的和 */
  vClues: number[]
  /** 参考解：每格 0 = 黑格/空，1..9 = 白格数字（内置题携带） */
  solution?: number[]
}

/** 数和盘面状态 */
export interface KakuroState extends GameState {
  /** 每格 0 = 空，1..9 = 已填数字；黑格恒为 0 */
  values: number[]
  /** 键盘光标（格子索引），无则为 undefined */
  selected?: number
}

/** 一段连续白格 */
export interface KakuroSegment {
  id: number
  dir: 'h' | 'v'
  /** 提示和；0 表示题面缺提示（非法题面） */
  clue: number
  /** 段内白格索引（按阅读方向） */
  cells: number[]
  /** 提示所在黑格索引；-1 表示缺提示 */
  clueCell: number
}

/** 解析后的完整题面模型 */
export interface KakuroModel {
  puzzle: KakuroPuzzle
  width: number
  height: number
  size: number
  /** 所有白格索引 */
  white: number[]
  segments: KakuroSegment[]
  /** 每格所属的横 / 纵段 id（-1 = 无） */
  hSeg: number[]
  vSeg: number[]
  /** 题面结构问题（缺提示、段长超限等） */
  issues: string[]
}

/** 实时校验结果 */
export interface KakuroResult extends ValidationResult {
  /** 尚未填写的白格数 */
  empty: number
  /** 白格总数 */
  totalWhite: number
  complete: boolean
  /** 需要高亮错误的格子 */
  badCells: number[]
  /** 出错的段 id */
  badSegments: number[]
  /** 段内有重复数字 */
  duplicateSegments: number[]
  /** 段内数字和已经超过提示 */
  overSegments: number[]
  /** 段已经填满但和不足 */
  shortSegments: number[]
  /** 剩余空格在数字不重复前提下无法凑出提示和 */
  impossibleSegments: number[]
  /** 题面缺提示的段 */
  missingClueSegments: number[]
  /** 错误总数（段级） */
  issueCount: number
}

/** puzzles-data.ts 的原始题面条目 */
export interface RawKakuroPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: 'easy' | 'medium' | 'hard' | 'custom'
  series: string
  /** 题面编码串，见 rules.ts 的 encodeBoard */
  board: string
  /** 参考解编码串（黑格为 0） */
  solution?: string
}

export function asKakuroPuzzle(p: Puzzle): KakuroPuzzle {
  return p as KakuroPuzzle
}

export function asKakuroState(s: GameState): KakuroState {
  return s as KakuroState
}
