/**
 * 数和（Kakuro）浏览器验证（Playwright + 本机 Edge）
 *
 * 覆盖：
 *   1. 内置题载入 / 题库数量；
 *   2. 鼠标左键只选中（不写入）、数字面板填数/清除、右键不参与数字输入；
 *   3. 键盘 1–9 填数、0/Backspace 清除、方向键移动光标（输入后不自动跳格）；
 *   4. 撤销 / 重做 / 检查 / 提示一格 / 显示解；
 *   5. 逻辑解题逐帧回放（等待回放结束并校验盘面）；
 *   6. 自定义题板：画黑格、文本导入、保存（唯一解审计）、载入、编辑回填、两步确认删除；
 *   7. 截图输出到 output/playwright/。
 *
 * 用法：先 `npm run build && npx vite preview --port 5212`（或 npm run dev），
 *      再 `node scripts/ui-check.mjs`。端口读 package.json 的 puzzle.port。
 */
import { chromium } from 'playwright-core'
import { PORT } from './_port.mjs'

const executablePath =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const browser = await chromium.launch({ headless: true, executablePath })
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
let pageErrors = 0
let failures = 0

page.on('pageerror', (e) => {
  pageErrors++
  console.log('PAGEERROR', e.message)
})
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('CONSOLE', msg.text())
})

const fail = (msg) => {
  failures++
  console.error(`FAIL: ${msg}`)
}
const ok = (msg) => console.log(`OK: ${msg}`)
const shot = async (name) => {
  await page.waitForTimeout(120)
  await page.screenshot({ path: `output/playwright/${name}.png`, fullPage: true })
}

const getSession = () =>
  page.evaluate(() => {
    const g = window.__game
    const s = g.getSession()
    return {
      puzzleId: s.puzzle.id,
      puzzleName: s.puzzle.name,
      width: s.puzzle.width,
      height: s.puzzle.height,
      values: [...s.state.values],
      selected: s.state.selected ?? null,
      hClues: [...(s.puzzle.hClues ?? [])],
      vClues: [...(s.puzzle.vClues ?? [])],
      blocks: [...(s.puzzle.blocks ?? [])],
      solved: g.adapter.validate(s.state, s.puzzle).solved,
      empty: g.adapter.validate(s.state, s.puzzle).empty,
    }
  })

const whiteIndexes = () =>
  page.evaluate(() => {
    const s = window.__game.getSession()
    return s.puzzle.blocks.map((b, i) => (b ? -1 : i)).filter((i) => i >= 0)
  })

async function cellPoint(index) {
  const data = await page.evaluate((idx) => {
    const g = window.__game
    const s = g.getSession()
    const m = g.adapter.metricsFor(s.puzzle)
    const svg = document.querySelector('svg.board-svg')
    if (!svg) return null
    const r = svg.getBoundingClientRect()
    const vb = svg.viewBox.baseVal
    return {
      originX: m.originX ?? m.pad,
      originY: m.originY ?? m.pad,
      cell: m.cell,
      width: m.width,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      vb: { x: vb.x, y: vb.y, width: vb.width, height: vb.height },
      index: idx,
    }
  }, index)
  if (!data) return null
  const col = index % data.width
  const row = Math.floor(index / data.width)
  const sx = data.rect.width / data.vb.width
  const sy = data.rect.height / data.vb.height
  return {
    x: data.rect.x + (data.originX + col * data.cell + data.cell / 2 - data.vb.x) * sx,
    y: data.rect.y + (data.originY + row * data.cell + data.cell / 2 - data.vb.y) * sy,
  }
}

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
await page.waitForSelector('svg.board-svg')

const title = await page.title()
if (!title.includes('数和')) fail(`页面标题不是数和：${title}`)
else ok(`页面标题：${title}`)

const puzzleCount = await page.locator('.puzzle-item').count()
if (puzzleCount !== 8) fail(`内置题数量 ${puzzleCount} != 8`)
else ok('内置题库 8 道')
await shot('01-initial')

/* ── 1. 载入 5×5 内置题 ── */
await page.locator('.puzzle-item', { hasText: '初识数和' }).first().click()
await page.waitForTimeout(150)
let session = await getSession()
if (session.puzzleName !== '初识数和 5×5') fail(`选中题目异常：${session.puzzleName}`)
else ok(`载入内置题「${session.puzzleName}」`)
if (session.values.some((v) => v !== 0)) fail('新题盘面不是空的')
await shot('02-puzzle')

const whites = await whiteIndexes()
const emptyWhites = async () => {
  const s = await getSession()
  return whites.filter((i) => s.values[i] === 0)
}

/* ── 2. 鼠标左键只选中（不写入）；数字面板写入；右键不参与数字输入 ── */
const empties = await emptyWhites()
const target = empties[0]
let pt = await cellPoint(target)
await page.mouse.click(pt.x, pt.y)
session = await getSession()
if (session.values[target] !== 0) fail(`左键点击后格子值 ${session.values[target]} != 0（应只选中）`)
else ok('左键点击只选中、不写入')
if (session.selected !== target) fail(`点击后光标未移到该格（${session.selected} != ${target}）`)
else ok('点击后光标移到该格')
// 再点一次：不循环
await page.mouse.click(pt.x, pt.y)
session = await getSession()
if (session.values[target] !== 0) fail('再次左键点击不应循环写入')
else ok('再次左键点击不循环')
// 数字面板写入选中格
await page.click('#digit-pad [data-digit="3"]')
await page.waitForTimeout(120)
session = await getSession()
if (session.values[target] !== 3) fail(`数字面板写入失败：${session.values[target]} != 3`)
else ok('数字面板写入选中格')
if (session.selected !== target) fail('数字面板写入后光标不应移动')
else ok('数字面板写入后光标保持')
await page.click('#digit-pad [data-digit="0"]')
await page.waitForTimeout(120)
session = await getSession()
if (session.values[target] !== 0) fail('数字面板清除失败')
else ok('数字面板清除')
await shot('03-mouse-input')

pt = await cellPoint(target)
await page.mouse.click(pt.x, pt.y, { button: 'right' })
session = await getSession()
if (session.values[target] !== 0) fail(`右键后格子值 ${session.values[target]} != 0（右键不应清除）`)
else ok('右键不参与数字输入（不清除）')

/* ── 3. 键盘 1–9 / 0 / 方向键 ── */
await page.mouse.click(pt.x, pt.y)
await page.keyboard.press('5')
session = await getSession()
if (session.values[target] !== 5) fail(`键盘 5 后格子值 ${session.values[target]} != 5`)
else ok('键盘 1–9 填数')
await page.keyboard.press('0')
session = await getSession()
if (session.values[target] !== 0) fail(`键盘 0 后格子值 ${session.values[target]} != 0`)
else ok('键盘 0 清空')

// 找一个正下方也是白格的格子，验证方向键（5×5 可能没有相邻白格，换 9×9 测）
let arrowTested = false
for (const puzzleName of ['初识数和', '九九归一']) {
  if (arrowTested) break
  await page.locator('.puzzle-item', { hasText: puzzleName }).first().click()
  await page.waitForTimeout(150)
  const s = await getSession()
  const white = await whiteIndexes()
  let from = -1
  for (const i of white) {
    if (white.includes(i + s.width)) {
      from = i
      break
    }
  }
  if (from < 0) continue
  pt = await cellPoint(from)
  await page.mouse.click(pt.x, pt.y)
  await page.keyboard.press('ArrowDown')
  const after = await getSession()
  if (after.selected !== from + s.width) {
    fail(`方向键下移后光标 ${after.selected} != ${from + s.width}`)
  } else {
    ok(`方向键移动光标（${puzzleName}）`)
  }
  await page.keyboard.press('0')
  arrowTested = true
}
if (!arrowTested) fail('找不到可用于方向键测试的相邻白格')

// 拖拽不涂写：找两个水平相邻的白格，从第一格拖到第二格，两格都不应被写入
{
  const s = await getSession()
  const white = await whiteIndexes()
  let pair = null
  for (const i of white) {
    if (white.includes(i + 1) && (i + 1) % s.width !== 0) {
      pair = [i, i + 1]
      break
    }
  }
  if (pair) {
    await page.click('#btn-clear')
    await page.waitForTimeout(80)
    const p1 = await cellPoint(pair[0])
    const p2 = await cellPoint(pair[1])
    await page.mouse.move(p1.x, p1.y)
    await page.mouse.down()
    await page.mouse.move(p2.x, p2.y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(150)
    const s2 = await getSession()
    if (s2.values[pair[0]] !== 0 || s2.values[pair[1]] !== 0) {
      fail(`左键拖动不应写入数字：${s2.values[pair[0]]}, ${s2.values[pair[1]]}`)
    } else ok('左键拖动不改数字（不涂写）')
  } else {
    fail('找不到水平相邻白格用于拖动测试')
  }
}

// 回到 5×5 做后续检查 / 提示 / 逻辑回放（回放更快）
await page.locator('.puzzle-item', { hasText: '初识数和' }).first().click()
await page.waitForTimeout(150)

/* ── 3.5 实时校验：同段重复数字 → 错误高亮 ── */
await page.click('#btn-clear')
await page.waitForTimeout(80)
const dupPair = await page.evaluate(() => {
  const s = window.__game.getSession()
  const p = s.puzzle
  const w = p.width
  const h = p.height
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!p.blocks[i] || !(p.hClues[i] > 0)) continue
      const cells = []
      for (let k = x + 1; k < w && !p.blocks[y * w + k]; k++) cells.push(y * w + k)
      if (cells.length >= 2) return cells.slice(0, 2)
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!p.blocks[i] || !(p.vClues[i] > 0)) continue
      const cells = []
      for (let k = y + 1; k < h && !p.blocks[k * w + x]; k++) cells.push(k * w + x)
      if (cells.length >= 2) return cells.slice(0, 2)
    }
  }
  return null
})
if (!dupPair) {
  fail('找不到可以制造重复的段')
} else {
  for (const index of dupPair) {
    const q = await cellPoint(index)
    await page.mouse.click(q.x, q.y)
    await page.keyboard.press('1')
    await page.waitForTimeout(70)
  }
  const check = await page.evaluate(() => {
    const g = window.__game
    const s = g.getSession()
    const r = g.adapter.validate(s.state, s.puzzle)
    return {
      dup: r.duplicateSegments?.length ?? 0,
      badCells: r.badCells?.length ?? 0,
      svgBad: document.querySelectorAll('svg .kk-cell.bad').length,
      svgOverlay: document.querySelectorAll('svg .kk-bad').length,
    }
  })
  if (check.dup < 1) fail(`同段重复数字没有被校验出来：${JSON.stringify(check)}`)
  else ok(`实时校验识别段内重复（${check.dup} 段）`)
  if (check.svgBad < 2 || check.svgOverlay < 2) fail(`错误格没有高亮：${JSON.stringify(check)}`)
  else ok('错误格高亮')
  await shot('05-validation')
  await page.click('#btn-clear')
  await page.waitForTimeout(80)
}


/* ── 4. 撤销 / 重做 ── */
const undoCell = (await emptyWhites())[0]
pt = await cellPoint(undoCell)
await page.mouse.click(pt.x, pt.y)
await page.keyboard.press('1')
await page.waitForTimeout(80)
session = await getSession()
if (session.values[undoCell] !== 1) fail('撤销测试前未成功落子')
await page.click('#btn-undo')
session = await getSession()
if (session.values[undoCell] !== 0) fail('撤销后格子未清空')
else ok('撤销')
await page.click('#btn-redo')
session = await getSession()
if (session.values[undoCell] !== 1) fail('重做后格子未恢复')
else ok('重做')
await page.click('#btn-undo')

/* ── 5. 提示一格 / 显示解 / 检查 ── */
await page.click('#btn-clear')
await page.waitForTimeout(80)
await page.click('#btn-hint')
session = await getSession()
if (session.empty !== whites.length - 1) fail(`提示一格后空格数 ${session.empty}，应为 ${whites.length - 1}`)
else ok('提示一格')
await page.click('#btn-check')
await page.waitForTimeout(80)
await page.click('#btn-solve')
session = await getSession()
if (!session.solved) fail('显示解后盘面未通过校验')
else ok('显示解')
await shot('04-solved')

/* ── 6. 逻辑解题回放 ── */
await page.click('#btn-clear')
await page.waitForTimeout(100)
await page.click('#btn-logic')
await page.waitForFunction(
  () => {
    const btn = document.querySelector('#btn-logic')
    return !!btn && !btn.disabled && btn.textContent === '逻辑解题'
  },
  { timeout: 180000 },
)
await page.waitForTimeout(300)
session = await getSession()
if (!session.solved) fail('逻辑解题回放结束后盘面未解出')
else ok('逻辑解题回放解出 5×5')
const status = await page.locator('#status').textContent()
if (!status || !status.includes('逻辑')) console.log('status:', status)
await shot('05-logic-playback')

/* ── 7. 自定义题板 ── */
await page.click('#btn-custom')
await page.waitForTimeout(120)
const extrasVisible = await page.locator('#custom-extras').isVisible()
if (!extrasVisible) fail('自定义题板扩展面板未显示')
else ok('自定义题板扩展面板显示')
await page.click('#custom-regen')
await page.waitForTimeout(120)
let customCellCount = await page.locator('#custom-grid .custom-cell').count()
if (customCellCount !== 25) fail(`默认自定义网格 ${customCellCount} 格 != 25`)
else ok('默认 5×5 网格')
const blockCount0 = await page.locator('#custom-grid .custom-cell.kk-editor-block').count()
if (blockCount0 < 9) fail(`默认布局黑格 ${blockCount0} 个，第一行/列未自动涂黑`)
else ok(`默认布局黑格 ${blockCount0} 个（第一行/列）`)

// 鼠标切换白/黑格
const cycleIndex = 6 // 5×5 中第 2 行第 2 列（白格）
const cellSel = `#custom-grid .custom-cell[data-i="${cycleIndex}"]`
await page.click(cellSel)
await page.waitForTimeout(60)
if (!(await page.locator(cellSel).evaluate((el) => el.classList.contains('kk-editor-block')))) {
  fail('点击自定义网格白格没有变黑')
} else ok('鼠标点击白格涂黑')
// 键盘 0 把黑格变回白格（0 之后 core 会把光标右移一格）
await page.keyboard.press('0')
await page.waitForTimeout(80)
if (await page.locator(cellSel).evaluate((el) => el.classList.contains('kk-editor-block'))) {
  fail('键盘 0 没有把黑格变回白格')
} else ok('键盘 0 清空自定义格')
// 键盘 1 把光标所在格涂黑
const cursorCell = page.locator('#custom-grid .custom-cell.selected').first()
const cursorIndex = await cursorCell.getAttribute('data-i')
await page.keyboard.press('1')
await page.waitForTimeout(80)
const cursorSel = `#custom-grid .custom-cell[data-i="${cursorIndex}"]`
if (!(await page.locator(cursorSel).evaluate((el) => el.classList.contains('kk-editor-block')))) {
  fail('键盘 1 没有把白格涂黑')
} else ok('键盘 1 涂黑自定义格')
// 右键把黑格变回白格
const cursorBox = await page.locator(cursorSel).boundingBox()
await page.mouse.click(cursorBox.x + cursorBox.width / 2, cursorBox.y + cursorBox.height / 2, {
  button: 'right',
})
await page.waitForTimeout(100)
if (await page.locator(cursorSel).evaluate((el) => el.classList.contains('kk-editor-block'))) {
  fail('右键没有把黑格变回白格')
} else ok('右键把黑格变回白格')

// 导入内置 5×5 题面（布局 + 提示和），再保存 / 载入 / 编辑 / 删除
const importText = await page.evaluate(() => {
  const a = window.__game.adapter
  const p = a.builtinPuzzles[0]
  const board = a.custom.encodePuzzle(p).board
  return board
    .split('/')
    .map((row) => row.split(',').map((token) => (token === '.' ? '.' : token)).join(' '))
    .join('\n')
})
await page.fill('#kk-editor-text', importText)
await page.click('#kk-editor-import')
await page.waitForTimeout(200)
const importMsg = await page.locator('#custom-msg').textContent()
if (!importMsg || !importMsg.includes('导入')) fail(`文本导入没有成功提示：${importMsg}`)
else ok('自定义题板文本导入')
customCellCount = await page.locator('#custom-grid .custom-cell').count()
if (customCellCount !== 25) fail(`导入后网格 ${customCellCount} 格 != 25`)
await shot('06-custom-import')

await page.click('#custom-save')
await page.waitForTimeout(800)
const saveMsg = await page.locator('#custom-msg').textContent()
if (!saveMsg || !saveMsg.includes('唯一解')) fail(`保存后没有唯一解审计提示：${saveMsg}`)
else ok(`自定义题保存：${saveMsg}`)
const countAfterSave = await page.locator('.puzzle-item').count()
if (countAfterSave !== 9) fail(`保存后题库数量 ${countAfterSave} != 9`)
else ok('自定义题已加入题库')
await shot('07-custom-saved')

await page.click('#custom-apply')
await page.waitForTimeout(300)
session = await getSession()
if (!session.puzzleId.startsWith('kakuro-custom-')) fail('载入题板后当前题目不是自定义题')
else ok('载入自定义题板')
if (session.puzzleName.includes('5×5')) ok('自定义题尺寸 5×5')
await shot('08-custom-loaded')

// 编辑回填
const customRow = page.locator('.puzzle-row', { has: page.locator('.puzzle-item', { hasText: '自定义' }) }).first()
await customRow.locator('[data-edit]').click()
await page.waitForTimeout(250)
const editMsg = await page.locator('#custom-msg').textContent()
if (!editMsg || !editMsg.includes('正在编辑')) fail(`编辑状态提示异常：${editMsg}`)
else ok('自定义题进入编辑状态')
await page.click('#kk-editor-export')
await page.waitForTimeout(80)
const normalizeText = (text) =>
  text
    .trim()
    .split(/\s+/)
    .map((t) => (t === '#' ? '0.0' : t))
    .join(' ')
const exported = await page.inputValue('#kk-editor-text')
if (normalizeText(exported) !== normalizeText(importText)) {
  fail('编辑回填的题面与保存的题面不一致')
} else ok('编辑回填题面一致')
await shot('09-custom-edit')

// 修改一个横向提示和后保存 → 重新载入，确认题库中的数据真的被更新
const tokensRows = importText.split('\n').map((row) => row.split(/\s+/))
let clueTarget = null
outer: for (let y = 0; y < tokensRows.length; y++) {
  for (let x = 0; x < tokensRows[y].length; x++) {
    const token = tokensRows[y][x]
    if (token === '.' || token === '#') continue
    const [h] = token.split('.').map(Number)
    if (h > 0) {
      clueTarget = { index: y * tokensRows[y].length + x, h }
      break outer
    }
  }
}
if (!clueTarget) {
  fail('找不到可修改的横向提示')
} else {
  const cellSel = `#custom-grid .custom-cell[data-i="${clueTarget.index}"]`
  await page.click(cellSel)
  await page.waitForTimeout(80)
  const stillBlack = await page.locator(cellSel).evaluate((el) => el.classList.contains('kk-editor-block'))
  if (!stillBlack) fail('点击黑格后变成了白格（应只是选中）')
  const newH = clueTarget.h >= 44 ? clueTarget.h - 1 : clueTarget.h + 1
  await page.fill('#kk-editor-h', String(newH))
  await page.waitForTimeout(80)
  await page.click('#custom-save')
  await page.waitForTimeout(900)
  const countAfterEdit = await page.locator('.puzzle-item').count()
  if (countAfterEdit !== 9) fail(`编辑保存后题库数量 ${countAfterEdit} != 9（不应新增）`)
  else ok('编辑保存覆盖原题')
  await page.click('#custom-apply')
  await page.waitForTimeout(300)
  session = await getSession()
  if (session.hClues[clueTarget.index] !== newH) {
    fail(`编辑后的横向提示未写回题库：${session.hClues[clueTarget.index]} != ${newH}`)
  } else ok('编辑内容已写回题库并重新载入')
}

// 两步确认删除
const delBtn = page.locator('[data-del]').first()
await delBtn.click()
await page.waitForTimeout(120)
const confirmText = (await page.locator('[data-del]').first().textContent())?.trim()
if (confirmText !== '确认') fail(`第一次点删除后按钮文本 ${confirmText} != 确认`)
else ok('删除需要两步确认')
const afterFirstDel = await page.locator('.puzzle-item').count()
if (afterFirstDel !== 9) fail('第一次点删除就移除了题目')
await shot('10-custom-delete-confirm')
await page.locator('[data-del]').first().click()
await page.waitForTimeout(300)
const countAfterDelete = await page.locator('.puzzle-item').count()
if (countAfterDelete !== 8) fail(`删除后题库数量 ${countAfterDelete} != 8`)
else ok('自定义题删除成功')
await shot('11-custom-deleted')

/* ── 8. 刷新后内置题仍可用 ── */
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('svg.board-svg')
const countAfterReload = await page.locator('.puzzle-item').count()
if (countAfterReload !== 8) fail(`刷新后题库数量 ${countAfterReload} != 8`)
else ok('刷新后内置题正常载入')
await shot('12-reload')

console.log('pageErrors:', pageErrors, 'failures:', failures)
await browser.close()
if (pageErrors > 0 || failures > 0) process.exitCode = 1
else console.log('OK')
