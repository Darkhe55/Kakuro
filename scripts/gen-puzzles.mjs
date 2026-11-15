/**
 * 数和题库生成器入口
 *
 * 生成逻辑在 src/game/generator.ts（唯一解 + 逻辑规则可推满才收录）。
 * 运行：npm run gen
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { generatePuzzles } from '../src/game/generator.ts'
import { decodeBoard } from '../src/game/rules.ts'

const DATA_FILE = path.resolve('src/game/puzzles-data.ts')
const items = generatePuzzles()

if (!items.length) {
  throw new Error('[gen] 没有生成任何题目')
}

for (const p of items) {
  if (typeof p.id !== 'string' || !p.id) throw new Error(`[gen] 非法 id: ${JSON.stringify(p.id)}`)
  if (!Number.isInteger(p.width) || !Number.isInteger(p.height)) {
    throw new Error(`[gen] ${p.id} 宽高非法`)
  }
  const size = p.width * p.height
  if (typeof p.solution !== 'string' || p.solution.length !== size) {
    throw new Error(`[gen] ${p.id} 参考解长度 ${p.solution?.length} != ${size}`)
  }
  const board = decodeBoard(p.board, p.width, p.height)
  if (!board) throw new Error(`[gen] ${p.id} 题面编码无法解析`)
  const black = board.blocks.reduce((n, b) => n + b, 0)
  if (black === 0 || black === size) throw new Error(`[gen] ${p.id} 黑格数量异常`)
}

const lines = []
lines.push('/* 自动生成，勿手改。运行 npm run gen 重新生成。 */')
lines.push("import type { RawKakuroPuzzle } from './types.ts'")
lines.push('')
lines.push('export const RAW_PUZZLES: RawKakuroPuzzle[] = [')
for (const p of items) {
  lines.push(
    `  { id: ${JSON.stringify(p.id)}, name: ${JSON.stringify(p.name)}, width: ${p.width}, height: ${p.height}, difficulty: ${JSON.stringify(p.difficulty)}, series: ${JSON.stringify(p.series)}, board: ${JSON.stringify(p.board)}, solution: ${JSON.stringify(p.solution ?? '')} },`,
  )
}
lines.push(']')
lines.push('')
writeFileSync(DATA_FILE, lines.join('\n'))
console.log(`[gen] 写入 ${DATA_FILE}：${items.length} 题`)
for (const p of items) console.log(`[gen]   ${p.id} ${p.name} ${p.width}×${p.height}`)
