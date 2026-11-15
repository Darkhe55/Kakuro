/**
 * 数和（Kakuro）题库审计
 *
 * 检查项：
 *   1. 条目结构 / 尺寸 / 题面与参考解长度、编码可解析；
 *   2. 题面结构合法（每个白格都有横纵提示、段长 ≤ 9、提示和在可能区间内）；
 *   3. 参考解合法（每段不重复且和等于提示）；
 *   4. 唯一解（求解器最多找 2 个解）；
 *   5. 逻辑 soundness：从空盘开始按 LogicPlan 逐帧回放，
 *      每一帧都落在空白的白格、数字与参考解一致、落子后不出现任何段错误，
 *      最终盘面等于参考解且规则推演饱和；
 *   6. 自定义题面的编码 / 解码往返，以及唯一解审计可用。
 */

import { RAW_PUZZLES } from '../src/game/puzzles-data.ts'
import {
  decodeBoard,
  decodeRawPuzzle,
  decodeSolution,
  encodeBoard,
  encodeSolution,
  getModel,
} from '../src/game/rules.ts'
import { countSolutions, solvePuzzle } from '../src/game/solver.ts'
import { planLogicSolve } from '../src/game/logic.ts'
import { applyMove, createEmptyState } from '../src/game/state.ts'
import { validate } from '../src/game/validate.ts'
import {
  auditCustomPuzzle,
  decodeCustomPuzzle,
  encodeCustomPuzzle,
} from '../src/game/custom-editor.ts'

const raw = RAW_PUZZLES
let errors = 0
const fail = (msg) => {
  console.error(`[check] ✗ ${msg}`)
  errors++
}
const ids = new Set()
const sizes = new Set()

if (raw.length < 6) fail(`内置题只有 ${raw.length} 道，至少需要 6 道`)

for (const item of raw) {
  const label = `${item.id}「${item.name}」`
  if (ids.has(item.id)) fail(`${label} id 重复`)
  ids.add(item.id)
  if (!item.name) fail(`${label} 缺 name`)
  if (!['easy', 'medium', 'hard', 'custom'].includes(item.difficulty)) {
    fail(`${label} 难度非法：${item.difficulty}`)
  }
  if (
    !Number.isInteger(item.width) ||
    !Number.isInteger(item.height) ||
    item.width < 3 ||
    item.height < 3 ||
    item.width > 20 ||
    item.height > 20
  ) {
    fail(`${label} 宽高非法：${item.width}×${item.height}`)
    continue
  }
  sizes.add(`${item.width}x${item.height}`)
  const size = item.width * item.height

  // 1. 编码长度 / 可解析
  if (typeof item.board !== 'string' || !item.board) {
    fail(`${label} 缺题面编码`)
    continue
  }
  const rows = item.board.split('/')
  if (rows.length !== item.height) fail(`${label} 题面行数 ${rows.length} != ${item.height}`)
  for (const [y, row] of rows.entries()) {
    const cols = row.split(',')
    if (cols.length !== item.width) fail(`${label} 第 ${y + 1} 行格子数 ${cols.length} != ${item.width}`)
  }
  if (typeof item.solution !== 'string' || item.solution.length !== size) {
    fail(`${label} 参考解长度 ${item.solution?.length} != ${size}`)
    continue
  }
  const board = decodeBoard(item.board, item.width, item.height)
  const solution = decodeSolution(item.solution, size)
  if (!board) {
    fail(`${label} 题面编码无法解析`)
    continue
  }
  if (!solution) {
    fail(`${label} 参考解编码无法解析`)
    continue
  }
  const puzzle = decodeRawPuzzle(item)
  if (!puzzle) {
    fail(`${label} 解码题面失败`)
    continue
  }

  // 2. 题面结构
  const model = getModel(puzzle)
  if (model.issues.length > 0) {
    fail(`${label} 题面结构问题：${model.issues[0]}`)
    continue
  }

  // 3. 参考解合法
  const solvedCheck = validate({ puzzleId: puzzle.id, width: puzzle.width, height: puzzle.height, values: solution }, puzzle)
  if (!solvedCheck.solved) {
    fail(`${label} 参考解不合法（段和 / 重复）`)
    continue
  }

  // 4. 唯一解
  const counted = countSolutions(puzzle, 2, 300_000, 4000)
  if (counted.timedOut) {
    fail(`${label} 唯一解检查超时（${counted.nodes} 节点）`)
    continue
  }
  if (counted.count !== 1) {
    fail(`${label} 解不唯一：找到 ${counted.count} 组`)
    continue
  }
  const solved = solvePuzzle(puzzle, 400_000)
  if (!solved.solved || !solved.solution) {
    fail(`${label} 求解器找不到解`)
    continue
  }
  const solvedValues = solved.solution.values
  for (let i = 0; i < size; i++) {
    if (solvedValues[i] !== solution[i]) {
      fail(`${label} 求解器结果与参考解不一致（格 ${i}）`)
      break
    }
  }

  // 5. 逻辑 soundness
  const empty = createEmptyState(puzzle)
  const plan = planLogicSolve(puzzle, empty)
  if (plan.frames.length === 0) {
    fail(`${label} 逻辑计划没有产生任何落子`)
    continue
  }
  const replay = createEmptyState(puzzle)
  let frameError = 0
  for (const [k, frame] of plan.frames.entries()) {
    const i = frame.move.index
    if (i < 0 || i >= size) {
      fail(`${label} 第 ${k + 1} 帧索引越界`)
      frameError++
      break
    }
    if (model.white.indexOf(i) < 0) {
      fail(`${label} 第 ${k + 1} 帧落在黑格 ${i}`)
      frameError++
      break
    }
    if ((replay.values[i] ?? 0) !== 0) {
      fail(`${label} 第 ${k + 1} 帧目标格 ${i} 不是空的`)
      frameError++
      break
    }
    if (frame.move.from !== 0) {
      fail(`${label} 第 ${k + 1} 帧 from=${frame.move.from}，应为 0`)
      frameError++
      break
    }
    if (!Number.isInteger(frame.move.to) || frame.move.to < 1 || frame.move.to > 9) {
      fail(`${label} 第 ${k + 1} 帧数字非法：${frame.move.to}`)
      frameError++
      break
    }
    if (frame.move.to !== solution[i]) {
      fail(`${label} 第 ${k + 1} 帧数字 ${frame.move.to} 与参考解 ${solution[i]} 不符`)
      frameError++
      break
    }
    applyMove(replay, frame.move)
    const check = validate(replay, puzzle)
    if (check.issueCount > 0) {
      fail(`${label} 第 ${k + 1} 帧落子后出现错误（${check.badSegments.length} 段）`)
      frameError++
      break
    }
  }
  if (frameError > 0) continue

  const finalCheck = validate(replay, puzzle)
  if (!finalCheck.solved) {
    fail(`${label} 按逻辑计划回放后没有解出（还差 ${finalCheck.empty} 格）`)
    continue
  }
  if (!plan.saturated) fail(`${label} 逻辑计划未饱和（saturated=false）`)
  if (!plan.finalState) {
    fail(`${label} 逻辑计划缺 finalState`)
    continue
  }
  for (let i = 0; i < size; i++) {
    if ((plan.finalState.values[i] ?? 0) !== solution[i]) {
      fail(`${label} 逻辑计划终态与参考解不一致（格 ${i}）`)
      break
    }
  }

  // 6. 编码往返 + 自定义题唯一解审计
  const encoded = encodeBoard(puzzle)
  if (encoded !== item.board) fail(`${label} encodeBoard 往返不一致`)
  if (encodeSolution(puzzle, solution) !== item.solution) fail(`${label} encodeSolution 往返不一致`)
  const customRecord = { ...encodeCustomPuzzle(puzzle), id: puzzle.id, name: puzzle.name, width: puzzle.width, height: puzzle.height }
  const customDecoded = decodeCustomPuzzle(customRecord)
  if (!customDecoded) {
    fail(`${label} 自定义题解码失败`)
    continue
  }
  if (encodeBoard(customDecoded) !== item.board) fail(`${label} 自定义题编解码往返不一致`)
  const audit = auditCustomPuzzle(customDecoded)
  if (!audit.ok) fail(`${label} 自定义题唯一解审计失败：${audit.message}`)

  console.log(
    `[check] ✓ ${item.id}「${item.name}」${item.width}×${item.height} · 白格 ${model.white.length} · 唯一解 · 逻辑 ${plan.frames.length} 帧 / ${plan.ruleSteps} 规则步 · ${counted.nodes} 节点`,
  )
}

if (sizes.size < 6) fail(`不同尺寸只有 ${sizes.size} 种，至少需要 6 种（当前：${[...sizes].join('、')}）`)

console.log(`[check] 共 ${raw.length} 题，错误 ${errors}`)
if (raw.length === 0) console.warn('[check] 题库为空，请先运行 npm run gen。')
if (errors > 0) process.exitCode = 1
