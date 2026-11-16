/**
 * 数和（Kakuro）题面图片导入（全自动识图）
 *
 * 用法：
 *   node scripts/import-image.mjs <图片路径> [--width 62 --height 62] [--name 名称] [--series 识图]
 *                                  [--append] [--verify] [--dry] [--json out.json]
 *                                  [--map "簇=数字,..."] [--fix "x,y=h.v,..."] [--force]
 *
 * 流程：
 *   1. Playwright + Edge 打开图片到 canvas，取灰度像素；
 *   2. 「细线投影」定位网格线与格距，外扩到整块题板（支持超大 62×62 这类大盘面）；
 *   3. 每格取内部判断黑格 / 白格；黑格里的白色小字（提示和，1–45）连通域提取；
 *   4. 按字形相对格心的位置区分「右上 = 横向提示」「左下 = 纵向提示」，同侧相邻数字拼接；
 *   5. 字形聚类 + 多字体多字号模板匹配自动判读 1–9；对低置信簇用「题面结构约束」
 *      （白格必有横纵提示、段长 ≤9、提示和落在区间内）做小范围自动修复；--map 可人工覆盖；
 *   6. 预览题面；--verify 调项目 solver 求解 / 唯一性检查（大盘面通常超时，只警告）；
 *   7. --append 写入 src/game/imported-puzzles.ts（不会被 npm run gen 覆盖）。
 *
 * 题面编码沿用项目现有格式：行用 `/` 分隔、格用 `,` 分隔，白格 `.`，
 * 黑格写 `横提示.纵提示`（0 = 该方向无提示）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { encodeBoard, decodeRawPuzzle, getModel } from '../src/game/rules.ts'
import { countSolutions } from '../src/game/solver.ts'

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)

function edgePath() {
  for (const c of EDGE_CANDIDATES) if (c && existsSync(c)) return c
  throw new Error('找不到 Edge 可执行文件，请用 EDGE_PATH 指定')
}

const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)
function arg(flag, fallback = '') {
  const i = args.indexOf(flag)
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback
}
function argEq(flag) {
  for (const a of args) if (a.startsWith(flag + '=')) return a.slice(flag.length + 1)
  return null
}
const VALUE_FLAGS = new Set(['--name', '--series', '--json', '--map', '--fix', '--width', '--height', '--debug-cell'])
const imageArg = args.find((a) => !a.startsWith('--') && !VALUE_FLAGS.has(args[args.indexOf(a) - 1]))
if (!imageArg) {
  console.error(
    '用法：node scripts/import-image.mjs <图片路径> [--width 62 --height 62] [--name 名称] [--series 识图] [--append] [--verify] [--dry] [--json out.json] [--map "簇=数字,..."] [--fix "x,y=h.v,..."] [--force]',
  )
  process.exit(1)
}
const IMAGE = path.resolve(imageArg)
if (!existsSync(IMAGE)) {
  console.error('找不到图片:', IMAGE)
  process.exit(1)
}

const widthOpt = Number(arg('--width', '0')) || 0
const heightOpt = Number(arg('--height', '0')) || 0
const nameOpt = arg('--name')
const series = arg('--series', '识图')
const jsonOut = arg('--json')
const append = has('--append')
const verifyOpt = has('--verify')
const dry = has('--dry')
const force = has('--force')

const manualClusters = new Map()
const mapArg = argEq('--map') ?? arg('--map', '')
if (mapArg) {
  for (const pair of mapArg.split(/[,;]/)) {
    const m = /^\s*(\d+)\s*=\s*(\d)\s*$/.exec(pair)
    if (!m) {
      console.error(`--map 格式错误：${pair}（应为 簇号=数字）`)
      process.exit(1)
    }
    manualClusters.set(Number(m[1]), Number(m[2]))
  }
}
const cellFixes = new Map()
const fixArg = argEq('--fix') ?? arg('--fix', '')
if (fixArg) {
  for (const part of fixArg.split(';')) {
    const m = /^\s*(\d+)\s*,\s*(\d+)\s*=\s*(\d+)\.(\d+)\s*$/.exec(part)
    if (!m) {
      console.error(`--fix 格式错误：${part}（应为 x,y=横提示.纵提示，如 3,4=12.0）`)
      process.exit(1)
    }
    cellFixes.set(`${m[1]},${m[2]}`, [Number(m[3]), Number(m[4])])
  }
}

/* ───────────────────────── 浏览器端几何 + 字形提取 ───────────────────────── */

const dataUrl = `data:image/png;base64,${readFileSync(IMAGE).toString('base64')}`
const browser = await chromium.launch({ headless: true, executablePath: edgePath() })
const page = await browser.newPage()
await page.setContent('<canvas id="c"></canvas>')

const analysis = await page.evaluate(async ({ dataUrl, widthOpt, heightOpt }) => {
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const W = img.naturalWidth
  const H = img.naturalHeight
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d', { willReadFrequently: true })
  g.drawImage(img, 0, 0)
  const px = g.getImageData(0, 0, W, H).data
  const gray = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 255 : 0.299 * px[(y * W + x) * 4] + 0.587 * px[(y * W + x) * 4 + 1] + 0.114 * px[(y * W + x) * 4 + 2])

  // 1) 细网格线：深色 1–2px 且左右（上下）都是白格
  const linesOf = (axis) => {
    const n = axis === 'x' ? W : H
    const len = axis === 'x' ? H : W
    const score = new Int32Array(n)
    for (let i = 2; i < n - 2; i++) {
      let c = 0
      for (let j = 2; j < len - 2; j++) {
        const v = axis === 'x' ? gray(i, j) : gray(j, i)
        if (v >= 140) continue
        const a = axis === 'x' ? gray(i - 2, j) : gray(j, i - 2)
        const b = axis === 'x' ? gray(i + 2, j) : gray(j, i + 2)
        if (a >= 248 && b >= 248) c++
      }
      score[i] = c
    }
    const threshold = len * 0.04
    const peaks = []
    let start = -1
    for (let i = 0; i < n; i++) {
      const on = score[i] >= threshold
      if (on && start < 0) start = i
      if (!on && start >= 0) {
        peaks.push((start + i - 1) / 2)
        start = -1
      }
    }
    if (start >= 0) peaks.push((start + n - 1) / 2)
    return peaks
  }
  const fitLattice = (peaks) => {
    if (peaks.length < 4) return null
    const sorted = peaks.slice().sort((a, b) => a - b)
    const base = sorted[0]
    // 网格线可能缺条（黑格遮住），用「候选格距最小残差」而不是中位间距，避免累计漂移
    let best = null
    for (let pitch = 8; pitch <= 80; pitch += 0.01) {
      let err = 0
      let count = 0
      for (const v of sorted) {
        const k = Math.round((v - base) / pitch)
        const r = v - (base + k * pitch)
        err += r * r
        count++
      }
      if (count < 4) continue
      const score = err / count
      if (!best || score < best.score) best = { pitch, score }
    }
    if (!best) return null
    const pitch = best.pitch
    let sumK = 0
    let sumV = 0
    for (const v of sorted) {
      sumK += Math.round((v - base) / pitch)
      sumV += v
    }
    const origin = (sumV - pitch * sumK) / sorted.length
    return { pitch, origin }
  }
  const xPeaks = linesOf('x')
  const yPeaks = linesOf('y')
  const fx = fitLattice(xPeaks)
  const fy = fitLattice(yPeaks)
  if (!fx || !fy) throw new Error(`网格线识别失败：竖线 ${xPeaks.length} 条 / 横线 ${yPeaks.length} 条`)

  // 深色整体包围盒（题板范围，含 1–3px 外框）
  let bx0 = W
  let bx1 = -1
  let by0 = H
  let by1 = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (gray(x, y) >= 140) continue
      if (x < bx0) bx0 = x
      if (x > bx1) bx1 = x
      if (y < by0) by0 = y
      if (y > by1) by1 = y
    }
  }
  const pitchX = fx.pitch
  const pitchY = fy.pitch
  // 题板范围 = 深色包围盒（含 1–3px 外框）；格子数按整宽 / 格距取整，原点居中修正
  const spanX = bx1 - bx0
  const spanY = by1 - by0
  let NX = widthOpt || Math.round(spanX / pitchX)
  let NY = heightOpt || Math.round(spanY / pitchY)
  if (NX < 3 || NY < 3) throw new Error(`推断格子数过小：${NX}×${NY}`)
  const ox = (bx0 + bx1) / 2 - (NX * pitchX) / 2
  const oy = (by0 + by1) / 2 - (NY * pitchY) / 2
  const pitch = (pitchX + pitchY) / 2

  // 2) 黑白格判定：格心 48% 区域里深色占比 > 50% 视为黑格
  const black = new Array(NX * NY).fill(false)
  for (let r = 0; r < NY; r++) {
    for (let c = 0; c < NX; c++) {
      const xa = ox + c * pitch
      const ya = oy + r * pitch
      const mx = xa + pitch * 0.26
      const my = ya + pitch * 0.26
      const mw = pitch * 0.48
      let dark = 0
      let total = 0
      for (let y = Math.round(my); y < Math.round(my + mw); y++) {
        for (let x = Math.round(mx); x < Math.round(mx + mw); x++) {
          total++
          if (gray(x, y) < 100) dark++
        }
      }
      black[r * NX + c] = total > 0 && dark / total > 0.5
    }
  }

  // 3) 逐黑格提取小字形：先擦掉格子里的对角斜线（长 +1 斜率细线），再取连通域
  const NS = 20
  const inkAt = (x, y) => gray(x, y) >= 120
  const glyphs = []
  const eraseNeighbors = (erase, w, h, i, j) => {
    for (const [di, dj] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      const ni = i + di
      const nj = j + dj
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue
      erase[nj * w + ni] = 1
    }
  }
  for (let row = 0; row < NY; row++) {
    for (let col = 0; col < NX; col++) {
      if (!black[row * NX + col]) continue
      const xa = Math.round(ox + col * pitch)
      const ya = Math.round(oy + row * pitch)
      const w = Math.min(Math.round(pitch), W - xa)
      const h = Math.min(Math.round(pitch), H - ya)
      if (w < 8 || h < 8) continue
      const mask = new Uint8Array(w * h)
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) mask[j * w + i] = inkAt(xa + i, ya + j) ? 1 : 0
      }
      const erase = new Uint8Array(w * h)
      // 沿 +1 斜率对角线找长细线（斜线约 18px；数字笔画一般 <7px）
      for (let off = -h; off < w; off++) {
        let j = 0
        while (j < h) {
          const i = off + j
          if (i < 0 || i >= w || !mask[j * w + i]) {
            j++
            continue
          }
          let len = 0
          let jj = j
          while (jj < h) {
            const ii = off + jj
            if (ii < 0 || ii >= w || !mask[jj * w + ii]) break
            len++
            jj++
          }
          if (len >= 7) {
            for (let k = 0; k < len; k++) {
              const ii = off + j + k
              erase[(j + k) * w + ii] = 1
              eraseNeighbors(erase, w, h, ii, j + k)
            }
          }
          j = jj > j ? jj : j + 1
        }
      }
      const isInk = (i, j) => i >= 0 && j >= 0 && i < w && j < h && mask[j * w + i] && !erase[j * w + i]
      // 连通域
      const seenCell = new Uint8Array(w * h)
      const comps2 = []
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          if (seenCell[j * w + i] || !isInk(i, j)) continue
          let n = 0
          let minI = i
          let maxI = i
          let minJ = j
          let maxJ = j
          const st = [[i, j]]
          seenCell[j * w + i] = 1
          while (st.length) {
            const [x, y] = st.pop()
            n++
            if (x < minI) minI = x
            if (x > maxI) maxI = x
            if (y < minJ) minJ = y
            if (y > maxJ) maxJ = y
            for (let dj = -1; dj <= 1; dj++) {
              for (let di = -1; di <= 1; di++) {
                if (!di && !dj) continue
                const nx = x + di
                const ny = y + dj
                if (!isInk(nx, ny) || seenCell[ny * w + nx]) continue
                seenCell[ny * w + nx] = 1
                st.push([nx, ny])
              }
            }
          }
          comps2.push({ n, minI, maxI, minJ, maxJ })
        }
      }
      const normOf = (minI, minJ, maxI, maxJ) => {
        let ix0 = maxI + 1
        let iy0 = maxJ + 1
        let ix1 = minI - 1
        let iy1 = minJ - 1
        let ink = 0
        for (let j = minJ; j <= maxJ; j++) {
          for (let i = minI; i <= maxI; i++) {
            if (!isInk(i, j)) continue
            ink++
            if (i < ix0) ix0 = i
            if (i > ix1) ix1 = i
            if (j < iy0) iy0 = j
            if (j > iy1) iy1 = j
          }
        }
        if (ink < 4 || ix1 < ix0) return null
        const bw = ix1 - ix0 + 1
        const bh = iy1 - iy0 + 1
        const m = new Array(NS * NS).fill(0)
        for (let b = 0; b < NS; b++) {
          const sj = iy0 + Math.min(bh - 1, Math.floor((b * bh) / NS))
          for (let a = 0; a < NS; a++) {
            const si = ix0 + Math.min(bw - 1, Math.floor((a * bw) / NS))
            m[b * NS + a] = isInk(si, sj) ? 1 : 0
          }
        }
        return { m, ink, w: bw, h: bh, minI: ix0, maxI: ix1, minJ: iy0, maxJ: iy1 }
      }
      const splitCol = (minI, maxI, minJ, maxJ) => {
        let bestI = minI
        let bestInk = Infinity
        for (let i = minI; i <= maxI; i++) {
          let ink = 0
          for (let j = minJ; j <= maxJ; j++) if (isInk(i, j)) ink++
          if (ink < bestInk) {
            bestInk = ink
            bestI = i
          }
        }
        return bestI
      }
      for (const c of comps2) {
        const bw = c.maxI - c.minI + 1
        const bh = c.maxJ - c.minJ + 1
        if (bh < 5 || bh > 10) continue
        if (bw < 1 || bw > 13) continue
        if (c.n < 4 || c.n > 90) continue
        const parts = []
        if (bw <= 7) {
          parts.push([c.minI, c.minJ, c.maxI, c.maxJ])
        } else {
          // 相邻数字粘连：按列墨迹最少处切开
          const k = bw >= 11 ? 3 : 2
          const cuts = []
          let start = c.minI
          for (let q = 1; q < k; q++) {
            const expected = c.minI + Math.round((bw * q) / k)
            const cut = splitCol(
              Math.max(start + 1, expected - 3),
              Math.min(c.maxI - 1, expected + 3),
              c.minJ,
              c.maxJ,
            )
            cuts.push(cut)
            start = cut
          }
          let from = c.minI
          for (const cut of cuts) {
            parts.push([from, c.minJ, cut - 1, c.maxJ])
            from = cut
          }
          parts.push([from, c.minJ, c.maxI, c.maxJ])
        }
        for (const [a0, b0, a1, b1] of parts) {
          const gl = normOf(a0, b0, a1, b1)
          if (!gl) continue
          const absMinX = xa + gl.minI
          const absMinY = ya + gl.minJ
          glyphs.push({
            row,
            col,
            x: absMinX,
            y: absMinY,
            m: gl.m,
            ink: gl.ink,
            w: gl.w,
            h: gl.h,
          })
        }
      }
    }
  }

  return {
    W,
    H,
    NX,
    NY,
    pitch: Number(pitch.toFixed(3)),
    ox: Number(ox.toFixed(2)),
    oy: Number(oy.toFixed(2)),
    bbox: { bx0, bx1, by0, by1 },
    lineCount: { x: xPeaks.length, y: yPeaks.length },
    black,
    glyphs,
  }
}, { dataUrl, widthOpt, heightOpt })

/* ───────────────────────── 字形模板 ───────────────────────── */

const NS = 20
const DIGITS = '0123456789'
const templates = await page.evaluate(({ NS, DIGITS }) => {
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const g = canvas.getContext('2d', { willReadFrequently: true })
  const FONTS = ['Arial', 'Segoe UI', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Calibri', 'Microsoft YaHei', 'Consolas']
  const WEIGHTS = [400, 700]
  const SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56]
  const out = {}
  for (const ch of DIGITS) out[ch] = []
  const norm = (data, threshold) => {
    let x0 = 96
    let y0 = 96
    let x1 = -1
    let y1 = -1
    let ink = 0
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        if (data[(y * 96 + x) * 4] >= threshold) continue
        ink++
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    if (!ink) return null
    const bw = x1 - x0 + 1
    const bh = y1 - y0 + 1
    const m = new Array(NS * NS).fill(0)
    for (let j = 0; j < NS; j++) {
      const sy = y0 + Math.min(bh - 1, Math.floor((j * bh) / NS))
      for (let i = 0; i < NS; i++) {
        const sx = x0 + Math.min(bw - 1, Math.floor((i * bw) / NS))
        m[j * NS + i] = data[(sy * 96 + sx) * 4] < threshold ? 1 : 0
      }
    }
    return { m, w: bw, h: bh }
  }
  for (const font of FONTS) {
    for (const weight of WEIGHTS) {
      for (const size of SIZES) {
        for (const phase of [0, 0.25, 0.5, 0.75]) {
          for (const ch of DIGITS) {
            g.fillStyle = '#fff'
            g.fillRect(0, 0, 96, 96)
            g.fillStyle = '#000'
            g.font = `${weight} ${size}px "${font}"`
            g.textAlign = 'center'
            g.textBaseline = 'middle'
            g.fillText(ch, 48 + phase, 48 + phase)
            const data = g.getImageData(0, 0, 96, 96).data
            const t = norm(data, 160)
            if (t) out[ch].push({ m: t.m, w: t.w, h: t.h, font, weight, size })
          }
        }
      }
    }
  }
  return out
}, { NS, DIGITS })

function simShift(a, b, radius = 1) {
  let best = 0
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      let inter = 0
      let uni = 0
      for (let j = 0; j < NS; j++) {
        const bj = j + dy
        for (let i = 0; i < NS; i++) {
          const av = a[j * NS + i]
          const bi = i + dx
          const bv = bj >= 0 && bj < NS && bi >= 0 && bi < NS ? b[bj * NS + bi] : 0
          if (av && bv) inter++
          if (av || bv) uni++
        }
      }
      const s = uni ? inter / uni : 0
      if (s > best) best = s
    }
  }
  return best
}

function clusterGlyphs(glyphs, threshold) {
  const clusters = []
  for (const glyph of glyphs) {
    let best = -1
    let bi = -1
    for (let k = 0; k < clusters.length; k++) {
      const s = simShift(glyph.m, clusters[k].proto)
      if (s > best) {
        best = s
        bi = k
      }
    }
    if (bi >= 0 && best >= threshold) {
      const cl = clusters[bi]
      cl.count++
      if (cl.count <= 80) {
        for (let i = 0; i < glyph.m.length; i++) cl.sum[i] += glyph.m[i]
        for (let i = 0; i < glyph.m.length; i++) cl.proto[i] = cl.sum[i] / cl.count >= 0.5 ? 1 : 0
      }
    } else {
      clusters.push({ count: 1, sum: glyph.m.slice(), proto: glyph.m.slice() })
    }
  }
  clusters.sort((a, b) => b.count - a.count)
  return clusters
}

/* ───────────────────────── 判读 ───────────────────────── */

const N = Math.min(analysis.NX, analysis.NY) === analysis.NX ? analysis.NX : analysis.NX
const NX = analysis.NX
const NY = analysis.NY
if (!analysis.glyphs.length) {
  console.error('[import] 没有识别到任何提示数字')
  process.exit(1)
}
const clusters = clusterGlyphs(analysis.glyphs, 0.9)
const clusterTable = clusters.map((cl, k) => {
  const scores = DIGITS.split('').map((ch) => {
    let best = 0
    let meta = null
    for (const t of templates[ch]) {
      const s = simShift(cl.proto, t.m)
      if (s > best) {
        best = s
        meta = t
      }
    }
    return { ch, score: best, meta }
  })
  scores.sort((a, b) => b.score - a.score)
  const manual = manualClusters.get(k)
  return {
    k,
    count: cl.count,
    label: manual ?? Number(scores[0].ch),
    auto: Number(scores[0].ch),
    margin: scores[0].score - scores[1].score,
    scores: scores.slice(0, 3),
    candidates: scores.slice(0, 4).map((s) => ({ label: Number(s.ch), score: s.score })),
    manual: manual !== undefined,
  }
})
console.log(
  `[import] ${path.basename(IMAGE)}：${analysis.W}×${analysis.H}px，格距 ${analysis.pitch}px，` +
    `识别 ${NX}×${NY}（网格线 ${analysis.lineCount.x}/${analysis.lineCount.y}，字形 ${analysis.glyphs.length} 个 / ${clusters.length} 簇）`,
)
console.log('[import] 字形簇判读（--map 簇号=数字 可人工覆盖）：')
for (const row of clusterTable) {
  const flag = row.manual ? '人工' : row.margin < 0.1 ? '低置信' : '自动'
  console.log(
    `  簇${String(row.k).padStart(2)} n=${String(row.count).padStart(4)} → ${row.label}（${flag}，` +
      `${row.scores.map((s) => `${s.ch}:${s.score.toFixed(2)}`).join(' ')}）`,
  )
}

// 每个字形归属簇
const glyphCluster = analysis.glyphs.map((glyph) => {
  let best = -1
  let bi = 0
  clusters.forEach((cl, k) => {
    const s = simShift(glyph.m, cl.proto)
    if (s > best) {
      best = s
      bi = k
    }
  })
  return bi
})

// --debug-cell x,y：打印该黑格里所有字形的位图与判读（排错用）
const debugCell = (() => {
  const v = argEq('--debug-cell') ?? (has('--debug-cell') ? arg('--debug-cell') : null)
  if (!v) return null
  const m = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(v)
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null
})()
if (debugCell) {
  const chars = ' .:-=+*#%@'
  analysis.glyphs.forEach((glyph, i) => {
    if (glyph.row !== debugCell.y || glyph.col !== debugCell.x) return
    const k = glyphCluster[i]
    console.log(
      `[debug] (${glyph.col},${glyph.row}) 字形 ink=${glyph.ink} ${glyph.w}×${glyph.h} → 簇${k} 判 ${clusterTable[k]?.label}`,
    )
    for (let j = 0; j < 20; j++) {
      console.log('   ' + glyph.m.slice(j * 20, j * 20 + 20).map((bit) => (bit ? '#' : '.')).join(''))
    }
  })
}

// 把字形按（格, 横向/纵向）分组，拼成提示和
function buildClues(labels) {
  const perCell = new Map()
  analysis.glyphs.forEach((glyph, i) => {
    const key = glyph.row * NX + glyph.col
    if (!perCell.has(key)) perCell.set(key, { h: [], v: [] })
    const cellCy = analysis.oy + (glyph.row + 0.5) * analysis.pitch
    // 原图约定：黑格右上角 = 横向提示，左下角 = 纵向提示
    const side = glyph.y + glyph.h / 2 < cellCy ? 'h' : 'v'
    perCell.get(key)[side].push({ x: glyph.x, label: labels[glyphCluster[i]], cluster: glyphCluster[i] })
  })
  const hClues = new Array(NX * NY).fill(0)
  const vClues = new Array(NX * NY).fill(0)
  const clueGlyphs = new Map()
  for (const [key, groups] of perCell) {
    for (const side of ['h', 'v']) {
      const list = groups[side].sort((a, b) => a.x - b.x)
      if (!list.length) continue
      if (list.length > 2) {
        // 提示和最多两位；多余字形大概率是误识别，取最左两位
        list.length = 2
      }
      const value = Number(list.map((item) => item.label).join(''))
      if (side === 'h') hClues[key] = value
      else vClues[key] = value
      clueGlyphs.set(`${key}:${side}`, list.map((item) => item.cluster))
    }
  }
  return { hClues, vClues, clueGlyphs }
}

/**
 * 提示和级别修复：对「超出该段可能区间」的提示，尝试用该提示字形的候选数字组合
 * （每个字形 top-4 候选）找到合法值，优先保留模板得分高的组合。
 */
function repairClues(hClues, vClues, clueGlyphs) {
  const clueRange = (len) => {
    if (len <= 0) return { min: 0, max: 0 }
    const k = Math.min(len, 9)
    return { min: (k * (k + 1)) / 2, max: (k * (2 * 9 - k + 1)) / 2 }
  }
  const segLen = (cell, dir) => {
    const c = cell % NX
    const r = (cell / NX) | 0
    let len = 0
    if (dir === 'h') for (let k = c + 1; k < NX && !analysis.black[r * NX + k]; k++) len++
    else for (let k = r + 1; k < NY && !analysis.black[k * NX + c]; k++) len++
    return len
  }
  const fixed = []
  for (const dir of ['h', 'v']) {
    const clues = dir === 'h' ? hClues : vClues
    for (let cell = 0; cell < NX * NY; cell++) {
      if (!analysis.black[cell] || !(clues[cell] > 0)) continue
      const len = segLen(cell, dir)
      const { min, max } = clueRange(len)
      const value = clues[cell]
      if (len >= 1 && len <= 9 && value >= min && value <= max) continue
      const glyphs = clueGlyphs.get(`${cell}:${dir}`)
      if (!glyphs || !glyphs.length) continue
      const lists = glyphs.map((ci) => {
        const cands = clusterTable[ci]?.candidates ?? [{ label: clusterTable[ci]?.label ?? 0, score: 1 }]
        return cands.length ? cands : [{ label: clusterTable[ci]?.label ?? 0, score: 1 }]
      })
      let best = null
      const maxDigits = Math.min(lists.length, 2)
      const walk = (idx, digits, score) => {
        if (idx === maxDigits) {
          const v = Number(digits.join(''))
          if (v >= min && v <= max) {
            if (!best || score > best.score) best = { value: v, score }
          }
          return
        }
        for (const cand of lists[idx]) walk(idx + 1, [...digits, cand.label], score + cand.score)
      }
      if (len >= 1 && len <= 9) walk(0, [], 0)
      if (best) {
        clues[cell] = best.value
        fixed.push(`${dir}(${cell % NX},${(cell / NX) | 0})=${best.value}（原 ${value}）`)
      }
    }
  }
  return fixed
}

// 题面结构约束：返回违规数量 + 明细（用于自动修复 / 校验）
function structuralIssues(hClues, vClues) {
  const black = analysis.black
  const isBlack = (c, r) => c >= 0 && r >= 0 && c < NX && r < NY && black[r * NX + c]
  const issues = []
  const clueRange = (len) => {
    if (len <= 0) return { min: 0, max: 0 }
    const k = Math.min(len, 9)
    return { min: (k * (k + 1)) / 2, max: (k * (2 * 9 - k + 1)) / 2 }
  }
  const hSeg = new Array(NX * NY).fill(-1)
  const vSeg = new Array(NX * NY).fill(-1)
  let segCount = 0
  for (let r = 0; r < NY; r++) {
    for (let c = 0; c < NX; c++) {
      const i = r * NX + c
      if (!black[i]) continue
      const h = hClues[i]
      const v = vClues[i]
      if (h > 0) {
        const cells = []
        for (let k = c + 1; k < NX && !black[r * NX + k]; k++) cells.push(r * NX + k)
        if (!cells.length) {
          issues.push(`黑格 (${c},${r}) 有横向提示 ${h} 但右侧没有白格段`)
        } else if (cells.length > 9) {
          issues.push(`黑格 (${c},${r}) 横向段长 ${cells.length} > 9`)
        } else {
          const { min, max } = clueRange(cells.length)
          if (h < min || h > max) issues.push(`黑格 (${c},${r}) 横向提示 ${h} 不在 ${min}..${max}`)
          const id = segCount++
          for (const cell of cells) hSeg[cell] = id
        }
      }
      if (v > 0) {
        const cells = []
        for (let k = r + 1; k < NY && !black[k * NX + c]; k++) cells.push(k * NX + c)
        if (!cells.length) {
          issues.push(`黑格 (${c},${r}) 有纵向提示 ${v} 但下方没有白格段`)
        } else if (cells.length > 9) {
          issues.push(`黑格 (${c},${r}) 纵向段长 ${cells.length} > 9`)
        } else {
          const { min, max } = clueRange(cells.length)
          if (v < min || v > max) issues.push(`黑格 (${c},${r}) 纵向提示 ${v} 不在 ${min}..${max}`)
          const id = segCount++
          for (const cell of cells) vSeg[cell] = id
        }
      }
      if (issues.length > 4000) return issues
    }
  }
  // 每个白格必须同时属于横向段和纵向段（即左侧 / 上方有带提示的黑格）
  for (let r = 0; r < NY; r++) {
    for (let c = 0; c < NX; c++) {
      const i = r * NX + c
      if (black[i]) continue
      if (hSeg[i] < 0) issues.push(`白格 (${c},${r}) 左侧没有带横向提示的黑格`)
      if (vSeg[i] < 0) issues.push(`白格 (${c},${r}) 上方没有带纵向提示的黑格`)
      if (issues.length > 4000) return issues
    }
  }
  return issues
}

const labels = clusterTable.map((row) => row.label)
const built0 = buildClues(labels)
let hClues = built0.hClues
let vClues = built0.vClues
const clueGlyphs = built0.clueGlyphs
let issues = structuralIssues(hClues, vClues)
console.log(`[import] 题面结构校验：${issues.length} 个问题`)
for (let iter = 0; iter < 6 && issues.length; iter++) {
  const fixed = repairClues(hClues, vClues, clueGlyphs)
  if (!fixed.length) break
  console.log(`[import] 第 ${iter + 1} 轮提示和修复：${fixed.length} 条`)
  for (const item of fixed.slice(0, 10)) console.log('  · ' + item)
  issues = structuralIssues(hClues, vClues)
  console.log(`[import] 修复后剩余 ${issues.length} 个结构问题`)
}

/* ───────────────────────── 人工覆盖 ───────────────────────── */

for (const [key, [h, v]] of cellFixes) {
  const [x, y] = key.split(',').map(Number)
  if (x < 0 || y < 0 || x >= NX || y >= NY) {
    console.warn(`[import] --fix ${key} 越界，忽略`)
    continue
  }
  const i = y * NX + x
  if (h > 0 || v > 0) analysis.black[i] = true
  else analysis.black[i] = false
  hClues[i] = h
  vClues[i] = v
}
if (cellFixes.size) {
  const built = { hClues, vClues }
  issues = structuralIssues(built.hClues, built.vClues)
}

/* ───────────────────────── 预览 ───────────────────────── */

const cellsText = []
for (let r = 0; r < NY; r++) {
  const row = []
  for (let c = 0; c < NX; c++) {
    const i = r * NX + c
    if (!analysis.black[i]) row.push('.')
    else if (hClues[i] > 0 || vClues[i] > 0) row.push(`${hClues[i]}.${vClues[i]}`)
    else row.push('#')
  }
  cellsText.push(row.join(' '))
}
const whiteTotal = analysis.black.filter((b) => !b).length
const clueTotal = hClues.filter((v) => v > 0).length + vClues.filter((v) => v > 0).length
console.log(`[import] 识别题面 ${NX}×${NY}：黑格 ${NX * NY - whiteTotal}，白格 ${whiteTotal}，提示 ${clueTotal} 个`)
const shownRows = Math.min(NY, 24)
for (let r = 0; r < shownRows; r++) console.log('  ' + String(r).padStart(2) + ' ' + cellsText[r])
if (NY > shownRows) console.log(`  … 其余 ${NY - shownRows} 行略（--json 导出完整题面）`)
if (issues.length) {
  console.error(`[import] 题面结构问题 ${issues.length} 个：`)
  for (const msg of issues.slice(0, 20)) console.error('  - ' + msg)
  process.exitCode = 2
}

/* ───────────────────────── 编码题面 ───────────────────────── */

const puzzleStub = {
  id: 'import-temp',
  name: 'import-temp',
  width: NX,
  height: NY,
  difficulty: 'medium',
  blocks: analysis.black.map((b) => (b ? 1 : 0)),
  hClues,
  vClues,
}
const boardText = encodeBoard(puzzleStub)
const decoded = decodeRawPuzzle({ ...puzzleStub, board: boardText, solution: '' })
if (decoded) {
  const model = getModel(decoded)
  if (model.issues.length) {
    console.warn(`[import] 项目模型额外报告 ${model.issues.length} 个题面问题（前 5 条）：`)
    for (const msg of model.issues.slice(0, 5)) console.warn('  - ' + msg)
  }
}

/* ───────────────────────── 求解校验（可选） ───────────────────────── */

let solution = ''
let unique = false
if (!issues.length && verifyOpt) {
  const t0 = Date.now()
  const counted = countSolutions(decoded ?? puzzleStub, 2, 400_000, 8000)
  if (counted.timedOut) {
    console.warn(`[import] 唯一性检查超时（${counted.nodes} 节点，${Date.now() - t0}ms），仅警告（超大盘面属正常）`)
  } else if (counted.count === 0) {
    console.warn('[import] 题面无解：识别结果可能有误，请用 --map / --fix 修正')
  } else if (counted.count > 1) {
    console.warn(`[import] 解不唯一（至少 ${counted.count} 个），参考解留空`)
  } else {
    unique = true
    console.log(`[import] 唯一解 ✓（${Date.now() - t0}ms，${counted.nodes} 节点）`)
  }
}

/* ───────────────────────── 导出 / 写入 ───────────────────────── */

const id = `kakuro-img-${NX}x${NY}-${Date.now().toString(36)}`
const name = nameOpt || `识图 · 数和 ${NX}×${NY}`

if (jsonOut) {
  const file = path.resolve(jsonOut)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(
    file,
    JSON.stringify(
      {
        width: NX,
        height: NY,
        board: boardText,
        hClues,
        vClues,
        blocks: puzzleStub.blocks,
        solution,
        unique,
        structuralIssues: issues,
        source: path.basename(IMAGE),
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`[import] 已导出 JSON：${file}`)
}

if (append) {
  if (dry) {
    console.log('[import] --dry：跳过写入')
  } else if (issues.length && !force) {
    console.error(
      `[import] 题面仍有 ${issues.length} 个结构问题，拒绝写入（可用 --map / --fix 修正，或加 --force 强行写入）`,
    )
    process.exitCode = 2
  } else {
    const file = path.resolve('src/game/imported-puzzles.ts')
    const entry =
      `  { id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, width: ${NX}, height: ${NY}, ` +
      `difficulty: 'medium', series: ${JSON.stringify(series)}, board: ${JSON.stringify(boardText)}, ` +
      `solution: ${JSON.stringify(solution)} },\n`
    if (!existsSync(file)) {
      writeFileSync(
        file,
        `/* 图片识别导入的题（scripts/import-image.mjs --append 写入；npm run gen 不会覆盖） */\n` +
          `import type { RawKakuroPuzzle } from './types.ts'\n\nexport const IMPORTED_PUZZLES: RawKakuroPuzzle[] = [\n${entry}]\n`,
      )
    } else {
      let text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
      const marker = text.lastIndexOf(']')
      if (marker < 0) throw new Error('imported-puzzles.ts 格式异常：找不到结尾 ]')
      text = text.slice(0, marker).replace(/\s+$/, '') + '\n' + entry + text.slice(marker)
      writeFileSync(file, text)
    }
    console.log(`[import] 已写入 ${file}：${id} ${name}${unique ? '' : '（参考解为空）'}`)
    if (issues.length) console.warn(`[import] 注意：写入的题面仍带 ${issues.length} 个结构问题（--force）`)
  }
} else {
  console.log('[import] 预览模式（未写入）。加 --append 写入 src/game/imported-puzzles.ts。')
}

await browser.close()
