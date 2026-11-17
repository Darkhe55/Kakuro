/**
 * ════════════════════════════════════════════════════════════════════
 *  数和（Kakuro）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 状态：每格 0 = 空，1..9 = 数字；黑格永远为 0。
 * 落子：Move.index = 格子索引，from/to 为 0..9。
 *
 * 自定义题板复用 core 的通用 CustomEditor：
 *   - 网格值 null = 白格，1 = 黑格；
 *   - 提示和由 custom.extras 面板（custom-editor.ts）录入 / 文本导入；
 *   - 保存时自动做唯一解 + 逻辑可解性审计。
 */

import { playDrop, playPluck } from '../core/audio'
import type { CustomSupport, GameAdapter, GameState, Move, Puzzle } from '../core/types'
import {
  auditCustomPuzzle,
  buildCustomPuzzle,
  decodeCustomPuzzle,
  encodeCustomPuzzle,
  kakuroExtrasHtml,
  loadKakuroExtras,
  mountKakuroExtras,
  openKakuroExtras,
  resetKakuroExtras,
  toCustomGrid,
} from './custom-editor.ts'
import { planLogicSolve } from './logic'
import { builtinPuzzles, getReferenceSolution } from './puzzles'
import { flashForMove, hitTest, metricsFor, renderBoard } from './render'
import { solvePuzzle } from './solver'
import {
  applyMove,
  cloneState,
  createEmptyState,
  cursorOf,
  cycleValue,
  deserializeState,
  firstHintMove,
  invertMove,
  keyboardInput,
  moveCursor,
  rightClickValue,
  serializeState,
  setCursor,
  valueAt,
} from './state'
import type { KakuroPuzzle } from './types'
import { statusBits, validate } from './validate'

const meta = {
  title: '数和（Kakuro）',
  tagline: '把 1–9 填进白格：每段数字不重复，且和等于黑格提示',
  footerNote:
    '规则：白格填 1–9；每一段连续白格（横向或纵向）内数字不能重复，且该段数字之和等于黑格上的提示数。黑格左上角是横向提示，右下角是纵向提示。内置题均为唯一解，并且可以用逻辑规则推完。',
  storageKeyPrefix: 'kakuro',
  customIdPrefix: 'kakuro-custom-',
  customMinW: 3,
  customMinH: 3,
  customMaxW: 20,
  customMaxH: 20,
  targetKind: 'cell' as const,
  interactionHint:
    '<kbd>左键</kbd> 选中格 · <kbd>数字按钮</kbd>/<kbd>1–9</kbd> 填数 · <kbd>0</kbd>/<kbd>退格</kbd> 清除 · <kbd>方向键</kbd> 移动',
}

const custom: CustomSupport = {
  mode: 'cell',
  valueCycle: [null, 1],
  keyForDigit: (digit) => {
    if (digit === 0) return null
    if (digit === 1) return 1
    return undefined
  },
  cellLabel: (v) => (v == null ? '' : '■'),
  cellClass: (v) => (v == null ? '' : 'kk-editor-block'),
  hint:
    '点击白格涂黑；点击黑格选中后录入提示和；右键 / 数字 0 把黑格变回白格。也可用文本导入。',
  extras: {
    html: kakuroExtrasHtml,
    mount: mountKakuroExtras,
    reset: resetKakuroExtras,
    open: openKakuroExtras,
    load: (p, ctl) => loadKakuroExtras(p as KakuroPuzzle, ctl),
  },
  toGrid: (p) => {
    const kp = p as KakuroPuzzle
    if (!Array.isArray(kp.blocks) || kp.blocks.length !== kp.width * kp.height) return null
    const restored = toCustomGrid(kp)
    return restored.width > 0 ? restored : null
  },
  makePuzzle: (w, h, grid, existingId) => buildCustomPuzzle(w, h, grid, existingId),
  encodePuzzle: (p) => encodeCustomPuzzle(p as KakuroPuzzle),
  decodePuzzle: (record) => decodeCustomPuzzle(record),
  audit: (p) => auditCustomPuzzle(p as KakuroPuzzle),
}

const keyboard = {
  cursor: (state: GameState) => cursorOf(state),
  setCursor: (state: GameState, index: number | null) => setCursor(state, index),
  moveCursor: (state: GameState, puzzle: Puzzle, index: number | null, dx: number, dy: number) =>
    moveCursor(state, puzzle, index, dx, dy),
  input: (state: GameState, puzzle: Puzzle, index: number, digit: number) =>
    keyboardInput(state, puzzle, index, digit),
}

function playForMove(move: Move, streak: number): void {
  if (move.to === 0) playDrop(streak)
  else playPluck(streak, 0.7 + move.to * 0.03)
}

export const adapter: GameAdapter = {
  meta,
  builtinPuzzles,
  getReferenceSolution,
  createEmptyState,
  cloneState,
  cycleValue,
  rightClickValue,
  applyMove,
  invertMove,
  valueAt,
  serializeState,
  deserializeState,
  validate,
  statusBits,
  metricsFor,
  renderBoard,
  hitTest,
  planLogicSolve,
  solvePuzzle: (puzzle: Puzzle, maxNodes?: number) => solvePuzzle(puzzle, maxNodes),
  firstHintMove,
  custom,
  keyboard,
  playForMove,
  flashForMove,
}
