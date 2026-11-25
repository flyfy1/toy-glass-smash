import { audio } from './engine/AudioEngine'
import { track } from './analytics'
import { list, locale, t } from './i18n'
import { stats } from './share'
import { type Stage, Flash, HitStop, Shake, clamp, easeOutBack, haptic, rand, runLoop, setupCanvas } from './engine/juice'

// Dev only (frame sheets): ?seed=<n> makes every random choice repeatable.
const QS = new URLSearchParams(location.search)
if (import.meta.env.DEV && QS.has('seed')) {
  let a = Number(QS.get('seed')) >>> 0 || 1
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DEFAULT_WORDS = list('smash_words')
const FONT = locale === 'ja' ? 'system-ui, "Hiragino Sans", "Noto Sans CJK JP", sans-serif' : 'system-ui, "PingFang SC", "Hiragino Sans", "Noto Sans CJK SC", sans-serif'

interface Frag {
  img: HTMLCanvasElement
  /** the same piece without the word, for a recipient's card (never shown on screen) */
  blank?: HTMLCanvasElement
  ox: number // image offset relative to centroid
  oy: number
  w: number
  h: number
  x: number // centroid
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
}

type Pt = [number, number]

/** Outer end and heading of one main crack ray; creeping cracks grow from here. */
interface Ray {
  x: number
  y: number
  a: number
}

/** Glass splinter: a thin spinning triangle (normal blending), not an additive square. */
interface Sliver {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
  w: number
  l: number
  life: number
  max: number
  grav: number
  drag: number
  slow: boolean // shatter slivers ride the slow motion
  glint: boolean // 1 in 6 flash white for a frame as they turn edge-on
  side: number
  flash: boolean
}

/** 钉子户: the one shard that stays stuck in the frame after the shatter. */
interface Holdout {
  img: HTMLCanvasElement
  ox: number // image offset relative to the pivot
  oy: number
  w: number
  h: number
  px: number // pivot: the frame-side corner
  py: number
  poly: Pt[] // visible outline, relative to the pivot, at rot 0
  cx: number // centroid relative to the pivot
  cy: number
  dir: 1 | -1 // the way gravity turns it
  rot: number
  born: number
  nextSlip: number
  slip: number // accumulated slips (rad), and the eased value drawn
  slipShown: number
  label: { x: number; y: number; align: CanvasTextAlign }
  fall: { vy: number; vr: number; t0: number; py0: number; tapped: boolean } | null
}

const SLIVER_RGB = '225,244,255'

/** Polygon clipped to an axis-aligned rectangle (Sutherland–Hodgman). */
function clipRect(poly: Pt[], x0: number, y0: number, x1: number, y1: number): Pt[] {
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
  ]
  let out = poly
  for (const [inside, cut] of edges) {
    const src = out
    out = []
    for (let i = 0; i < src.length; i++) {
      const a = src[i]
      const b = src[(i + 1) % src.length]
      const ia = inside(a)
      const ib = inside(b)
      if (ia) out.push(a)
      if (ia !== ib) out.push(cut(a, b))
    }
    if (!out.length) break
  }
  return out
}
const area = (poly: Pt[]) => {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]
    const [x2, y2] = poly[(i + 1) % poly.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}
/** Inside the polygon, or within `pad` px of its outline. */
function nearPoly(poly: Pt[], x: number, y: number, pad: number) {
  let inside = false
  let best = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    const dx = xj - xi
    const dy = yj - yi
    const u = clamp(((x - xi) * dx + (y - yi) * dy) / (dx * dx + dy * dy || 1), 0, 1)
    best = Math.min(best, Math.hypot(xi + u * dx - x, yi + u * dy - y))
  }
  return inside || best <= pad
}

export interface GameApi {
  dispose(): void
  setWords(words: string[]): void
}

const makeCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(w))
  c.height = Math.max(1, Math.ceil(h))
  return c
}

/**
 * `onPeak` gets a picture of the shards in the air, a moment after each shatter. Words in `hide` (a
 * sender's words, on a recipient's screen) are left off that picture; the screen shows them as usual.
 */
const PEAKS = [1, 5, 20, 50]

export function startGame(canvas: HTMLCanvasElement, onFirst: () => void, initialWords: string[] = [], onPeak?: (snap: HTMLCanvasElement | null) => void, hide: string[] = []): GameApi {
  let pane = makeCanvas(1, 1)
  let cracks = makeCanvas(1, 1)
  // The player's own words come first; once they've all been smashed, the built-in
  // words for the player's language take over, then the cycle repeats.
  let customWords = initialWords
  let wordIdx = 0
  const sequence = () => [...customWords, ...DEFAULT_WORDS.filter((w) => !customWords.includes(w))]
  const word = () => {
    const seq = sequence()
    return seq[wordIdx % seq.length]
  }

  let wordRect = { x0: 0, y0: 0, x1: 0, y1: 0 } // where the word sits, for picking a holdout that carries part of it
  const { stage, dispose } = setupCanvas(canvas, (s) => rebuild(true, s))
  const shake = new Shake(30, 0.04, 1.7)
  const stop = new HitStop()
  const flash = new Flash()
  let frags: Frag[] = []

  let state: 'intact' | 'broken' | 'sliding' = 'intact'
  let damage = 0
  let threshold = 9
  let lastHit = -10
  let brokenAt = 0
  let slideT = 0
  let smashed = 0
  let started = false
  let time = 0
  let slowT = 1 // 0..1, ramps back to normal speed after a shatter
  let snapAt = 0 // when to take the card's picture (shards in the air, in slow motion)
  let snapBlank = false
  let rays: Ray[] = [] // every main ray on the current pane
  let creeps: { at: number; ray: Ray; len: number; vol: number }[] = []
  let slivers: Sliver[] = []
  let creak: { stop(): void } | null = null
  let critNext = 0
  let flickNext = 0
  let paneAlpha = 1
  let holdout: Holdout | null = null
  let holdoutDue = import.meta.env.DEV && QS.get('holdout') === '1'
  let holdoutPane = 0
  let frozen = import.meta.env.DEV && QS.get('freeze') === '1' // frame sheets start frozen so ?seed is repeatable

  function rebuild(clearCracks: boolean, s: Stage = stage) {
    const { w, h, dpr } = s
    pane = makeCanvas(w * dpr, h * dpr)
    drawPane(pane.getContext('2d')!, w, h, dpr)
    if (clearCracks || cracks.width !== pane.width || cracks.height !== pane.height) cracks = makeCanvas(w * dpr, h * dpr)
  }

  function drawPane(c: CanvasRenderingContext2D, w: number, h: number, dpr: number, text = word()) {
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    const bg = c.createLinearGradient(0, 0, w, h)
    bg.addColorStop(0, '#1b2740')
    bg.addColorStop(1, '#0a0f1c')
    c.fillStyle = bg
    c.fillRect(0, 0, w, h)
    // the annoying word
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.font = `900 100px ${FONT}`
    const mw = c.measureText(text).width
    const size = Math.min(h * 0.34, ((w * 0.84) / mw) * 100)
    c.font = `900 ${size}px ${FONT}`
    const tg = c.createLinearGradient(0, h / 2 - size / 2, 0, h / 2 + size / 2)
    tg.addColorStop(0, '#ff5a5f')
    tg.addColorStop(1, '#ff9f1c')
    c.shadowColor = 'rgba(255,60,60,0.65)'
    c.shadowBlur = size * 0.25
    c.fillStyle = tg
    c.fillText(text, w / 2, h / 2)
    const tw = (mw * size) / 100
    wordRect = { x0: w / 2 - tw / 2, y0: h / 2 - size * 0.4, x1: w / 2 + tw / 2, y1: h / 2 + size * 0.4 }
    c.shadowBlur = 0
    // glass sheen
    const sheen = (x0: number, wdt: number, a: number) => {
      const g = c.createLinearGradient(x0, 0, x0 + wdt, h * 0.6)
      g.addColorStop(0, 'rgba(255,255,255,0)')
      g.addColorStop(0.5, `rgba(255,255,255,${a})`)
      g.addColorStop(1, 'rgba(255,255,255,0)')
      c.fillStyle = g
      c.beginPath()
      c.moveTo(x0, 0)
      c.lineTo(x0 + wdt, 0)
      c.lineTo(x0 + wdt - h * 0.9, h)
      c.lineTo(x0 - h * 0.9, h)
      c.closePath()
      c.fill()
    }
    sheen(w * 0.25, w * 0.18, 0.09)
    sheen(w * 0.52, w * 0.05, 0.12)
    // frame + bolts
    c.strokeStyle = 'rgba(200,230,255,0.28)'
    c.lineWidth = 2
    c.strokeRect(8, 8, w - 16, h - 16)
    c.fillStyle = 'rgba(220,235,255,0.55)'
    for (const [bx, by] of [
      [22, 22],
      [w - 22, 22],
      [22, h - 22],
      [w - 22, h - 22],
    ]) {
      c.beginPath()
      c.arc(bx, by, 5, 0, Math.PI * 2)
      c.fill()
    }
  }

  function crackAt(x: number, y: number, power: number): Ray[] {
    const c = cracks.getContext('2d')!
    const dpr = stage.dpr
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.lineCap = 'round'
    const n = (9 + Math.random() * 6) | 0
    const ends: { a: number; end: number; pts: [number, number][] }[] = []
    const base = Math.min(stage.w, stage.h) * (0.18 + 0.12 * power)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.25, 0.25)
      const L = base * rand(0.5, 1.4)
      const pts: [number, number][] = [[x, y]]
      let ang = a
      const segs = 6
      for (let s = 1; s <= segs; s++) {
        ang += rand(-0.25, 0.25)
        const r = (L * s) / segs
        pts.push([x + Math.cos(ang) * r, y + Math.sin(ang) * r])
      }
      ends.push({ a, end: ang, pts })
      // occasional branch
      if (Math.random() < 0.5) {
        const k = 2 + ((Math.random() * 3) | 0)
        const [bx, by] = pts[k]
        const ba = a + rand(-0.9, 0.9)
        const bl = L * rand(0.2, 0.45)
        drawLine(c, [
          [bx, by],
          [bx + Math.cos(ba) * bl * 0.5 + rand(-4, 4), by + Math.sin(ba) * bl * 0.5 + rand(-4, 4)],
          [bx + Math.cos(ba) * bl, by + Math.sin(ba) * bl],
        ], 0.9)
      }
    }
    for (const e of ends) drawLine(c, e.pts, 1.5)
    // spider-web rings
    for (const frac of [0.33, 0.66]) {
      for (let i = 0; i < ends.length; i++) {
        if (Math.random() < 0.3) continue
        const p = ends[i].pts[Math.round(frac * 6)]
        const q = ends[(i + 1) % ends.length].pts[Math.round(frac * 6)]
        drawLine(c, [p, [(p[0] + q[0]) / 2 + rand(-5, 5), (p[1] + q[1]) / 2 + rand(-5, 5)], q], 1)
      }
    }
    // crushed core
    c.fillStyle = 'rgba(255,255,255,0.85)'
    c.beginPath()
    c.arc(x, y, 3 + power * 3, 0, Math.PI * 2)
    c.fill()
    c.strokeStyle = 'rgba(255,255,255,0.6)'
    c.lineWidth = 0.8
    for (let i = 0; i < 18; i++) {
      const a = rand(0, Math.PI * 2)
      const r1 = rand(3, 10)
      const r2 = r1 + rand(4, 16)
      c.beginPath()
      c.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1)
      c.lineTo(x + Math.cos(a + 0.2) * r2, y + Math.sin(a + 0.2) * r2)
      c.stroke()
    }
    const out = ends.map((e) => ({ x: e.pts[6][0], y: e.pts[6][1], a: e.end }))
    rays.push(...out)
    return out
  }

  const onScreen = (r: Ray) => r.x > 4 && r.y > 4 && r.x < stage.w - 4 && r.y < stage.h - 4

  /** Stressed glass: a ray grows from its outer end, with a dry tick. */
  function creep(r: Ray, len: number, vol: number) {
    if (!onScreen(r)) return
    const c = cracks.getContext('2d')!
    c.setTransform(stage.dpr, 0, 0, stage.dpr, 0, 0)
    c.lineCap = 'round'
    const a = r.a + rand(-0.2, 0.2)
    const nx = r.x + Math.cos(a) * len
    const ny = r.y + Math.sin(a) * len
    drawLine(c, [[r.x, r.y], [nx, ny]], 1.3)
    r.x = nx
    r.y = ny
    r.a = a
    audio.tick(vol, (nx / stage.w) * 1.2 - 0.6)
  }

  /** Glass slivers. Defaults are the per-hit splinters; the shatter passes its own speed, life, gravity and drag. */
  function splinter(x: number, y: number, n: number, o: { speed?: number; life?: number; grav?: number; drag?: number; slow?: boolean; big?: boolean } = {}) {
    const { speed = 700, grav = 2200, drag = 0.97, slow = false, big = false } = o
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = speed * (0.2 + Math.random() * 0.9)
      const life = (o.life ?? 0.6) * (0.5 + Math.random() * 0.7)
      slivers.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        rot: rand(0, Math.PI * 2),
        vr: rand(4, 14) * (Math.random() < 0.5 ? -1 : 1),
        w: big ? rand(2, 3.5) : rand(2, 3),
        l: big ? rand(7, 13) : rand(6, 10),
        life,
        max: life,
        grav,
        drag,
        slow,
        glint: Math.random() < 1 / 6,
        side: 0,
        flash: false,
      })
    }
  }

  function drawLine(c: CanvasRenderingContext2D, pts: [number, number][], wdt: number) {
    c.beginPath()
    pts.forEach(([px, py], i) => (i ? c.lineTo(px + 1, py + 1.2) : c.moveTo(px + 1, py + 1.2)))
    c.strokeStyle = 'rgba(0,0,0,0.45)'
    c.lineWidth = wdt + 0.6
    c.stroke()
    c.beginPath()
    pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)))
    c.strokeStyle = 'rgba(235,248,255,0.9)'
    c.lineWidth = wdt
    c.stroke()
  }

  function hit(x: number, y: number) {
    damage++
    lastHit = time
    const p = clamp(damage / threshold, 0, 1)
    if (damage >= threshold) return shatter(x, y)
    const fresh = crackAt(x, y, p).filter(onScreen)
    // 2 or 3 of the new rays creep on by 15 to 30 px over the next 250 ms, in 3 ticks each
    for (let j = 0, n = Math.min(fresh.length, 2 + ((Math.random() * 2) | 0)); j < n; j++) {
      const r = fresh.splice((Math.random() * fresh.length) | 0, 1)[0]
      const len = rand(15, 30) / 3
      for (let k = 0; k < 3; k++) creeps.push({ at: time + (40 + k * 80 + j * 20 + rand(-8, 8)) / 1000, ray: r, len, vol: 0.6 })
    }
    audio.glassHit(0.25 + 0.75 * p)
    shake.add(0.28 + 0.3 * p)
    stop.trigger(16 + 20 * p)
    flash.fire(0.12 + 0.1 * p, '220,240,255')
    haptic(20 + Math.round(30 * p))
    splinter(x, y, 26 + damage * 4)
  }

  function shatter(x: number, y: number) {
    const { w, h, dpr } = stage
    creak?.stop()
    creak = null
    paneAlpha = 1
    creeps = []
    if (holdout) dropHoldout(holdout.fall?.tapped ?? false, true)
    crackAt(x, y, 1)
    const snap = makeCanvas(w * dpr, h * dpr)
    const sc = snap.getContext('2d')!
    sc.drawImage(pane, 0, 0)
    sc.drawImage(cracks, 0, 0)
    // a sender's word on a recipient's screen: the card's picture gets the pieces without it
    let blank: HTMLCanvasElement | null = null
    if (hide.includes(word())) {
      const keep = wordRect
      blank = makeCanvas(w * dpr, h * dpr)
      const bc = blank.getContext('2d')!
      drawPane(bc, w, h, dpr, '')
      bc.setTransform(1, 0, 0, 1, 0, 0)
      bc.drawImage(cracks, 0, 0)
      wordRect = keep
    }
    const cut = (src: HTMLCanvasElement, poly: [number, number][], minX: number, minY: number, fw: number, fh: number) => {
      const img = makeCanvas(fw * dpr, fh * dpr)
      const c = img.getContext('2d')!
      c.setTransform(dpr, 0, 0, dpr, -minX * dpr, -minY * dpr)
      c.beginPath()
      poly.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)))
      c.closePath()
      c.save()
      c.clip()
      c.setTransform(1, 0, 0, 1, 0, 0)
      c.drawImage(src, -minX * dpr, -minY * dpr)
      c.restore()
      c.strokeStyle = 'rgba(220,245,255,0.7)'
      c.lineWidth = 1.2
      c.stroke()
      return img
    }

    // polar cell grid around the impact
    const D = Math.max(Math.hypot(x, y), Math.hypot(w - x, y), Math.hypot(x, h - y), Math.hypot(w - x, h - y)) * 1.08
    const N = 8
    const M = 18
    const verts: [number, number][][] = []
    const a0 = rand(0, Math.PI * 2)
    for (let k = 1; k <= N; k++) {
      const row: [number, number][] = []
      for (let j = 0; j < M; j++) {
        const r = D * Math.pow(k / N, 1.35) * (k === N ? 1 : rand(0.9, 1.1))
        const a = a0 + ((j + rand(-0.3, 0.3)) / M) * Math.PI * 2
        row.push([x + Math.cos(a) * r, y + Math.sin(a) * r])
      }
      verts.push(row)
    }
    frags = []
    const cands: { f: Frag; clip: Pt[]; word: boolean }[] = []
    for (let k = 0; k < N; k++)
      for (let j = 0; j < M; j++) {
        const j2 = (j + 1) % M
        const poly: [number, number][] = k === 0 ? [[x, y], verts[0][j], verts[0][j2]] : [verts[k - 1][j], verts[k - 1][j2], verts[k][j2], verts[k][j]]
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        let cx = 0
        let cy = 0
        for (const [px, py] of poly) {
          minX = Math.min(minX, px)
          minY = Math.min(minY, py)
          maxX = Math.max(maxX, px)
          maxY = Math.max(maxY, py)
          cx += px / poly.length
          cy += py / poly.length
        }
        if (maxX < 0 || maxY < 0 || minX > w || minY > h) continue
        minX = Math.max(minX, -2)
        minY = Math.max(minY, -2)
        maxX = Math.min(maxX, w + 2)
        maxY = Math.min(maxY, h + 2)
        const fw = maxX - minX
        const fh = maxY - minY
        if (fw < 1 || fh < 1) continue
        const img = cut(snap, poly, minX, minY, fw, fh)
        const dx = cx - x
        const dy = cy - y
        const dist = Math.hypot(dx, dy) + 1
        const near = 1 - clamp(dist / D, 0, 1)
        const sp = 250 + 1300 * near * near + rand(0, 200)
        // 钉子户 candidates: touches the left, right or top edge, 3 to 7 % of the pane on screen
        const clip = clipRect(poly, 0, 0, w, h)
        const on = clip.length > 2 ? area(clip) : 0
        // (and clear of the bottom band with the counter and the pills, so it is seen and its label fits)
        if (on > 0.03 * w * h && on < 0.07 * w * h && clip.every(([, py]) => py < h - 120) && clip.some(([px, py]) => px <= 0.5 || px >= w - 0.5 || py <= 0.5)) {
          const wc = clipRect(clip, wordRect.x0, wordRect.y0, wordRect.x1, wordRect.y1)
          cands.push({ f: null as unknown as Frag, clip, word: wc.length > 2 && area(wc) > on * 0.04 })
        }
        frags.push({
          img,
          blank: blank ? cut(blank, poly, minX, minY, fw, fh) : undefined,
          ox: minX - cx,
          oy: minY - cy,
          w: fw,
          h: fh,
          x: cx,
          y: cy,
          vx: (dx / dist) * sp + rand(-60, 60),
          vy: (dy / dist) * sp - rand(100, 450),
          rot: 0,
          vr: rand(-1, 1) * (1.5 + 7 * near),
        })
        if (cands.length && cands[cands.length - 1].f === null) cands[cands.length - 1].f = frags[frags.length - 1]
      }
    state = 'broken'
    brokenAt = time
    slowT = 0
    smashed++
    // pane 3 of a session always has a holdout (or the next pane that can), then one random pane in each block of 4
    if (smashed >= 4 && (smashed - 4) % 4 === 0) holdoutPane = smashed + ((Math.random() * 4) | 0)
    if (smashed === 3 || smashed === holdoutPane) holdoutDue = true
    if (holdoutDue && cands.length) {
      // side pieces read best (the top edge sits under the input and the shards thrown upward); then part of the word
      const rank = (c: (typeof cands)[number]) => (c.clip.some(([px]) => px <= 0.5 || px >= w - 0.5) ? 2 : 0) + (c.word ? 1 : 0)
      const top = Math.max(...cands.map(rank))
      const pool = cands.filter((c) => rank(c) === top)
      const pick = pool[(Math.random() * pool.length) | 0]
      frags.splice(frags.indexOf(pick.f), 1)
      holdout = makeHoldout(pick.f, pick.clip)
      holdoutDue = false
    }
    stats.n = (stats.n ?? 0) + 1 // panes smashed this visit: the share line switches to the done form
    track('shatter', { panes: smashed })
    // a picture only where a card is drawn (panes 1, 5, 20, 50); the others just pass the count on
    if (PEAKS.includes(smashed)) snapAt = time + 0.2
    else onPeak?.(null)
    stop.trigger(60)
    flash.fire(0.9, '235,245,255')
    shake.add(1)
    haptic([40, 30, 120, 40, 200])
    audio.shatter()
    splinter(x, y, 380, { speed: 1600, life: 1.6, grav: 1800, drag: 0.975, slow: true, big: true })
  }

  function makeHoldout(f: Frag, clip: Pt[]): Holdout {
    const { w, h } = stage
    const on = (p: Pt) => ({ top: p[1] <= 0.5, left: p[0] <= 0.5, right: p[0] >= w - 0.5 })
    // the edge it shares most with the frame
    const span = (pred: (p: Pt) => boolean, axis: 0 | 1) => {
      const v = clip.filter(pred).map((p) => p[axis])
      return v.length > 1 ? Math.max(...v) - Math.min(...v) : 0
    }
    const top = span((p) => on(p).top, 0)
    const left = span((p) => on(p).left, 1)
    const right = span((p) => on(p).right, 1)
    const cx = clip.reduce((s, p) => s + p[0], 0) / clip.length
    const cy = clip.reduce((s, p) => s + p[1], 0) / clip.length
    let pivot: Pt
    if (top >= left && top >= right) {
      // hangs from the top edge by the end farther from its centre of mass
      const xs = clip.filter((p) => on(p).top).map((p) => p[0])
      const a = Math.min(...xs)
      const b = Math.max(...xs)
      pivot = [Math.abs(cx - a) > Math.abs(cx - b) ? a : b, 0]
    } else {
      const side = left >= right ? 0 : w
      const ys = clip.filter((p) => (side ? on(p).right : on(p).left)).map((p) => p[1])
      pivot = [side, Math.min(...ys)] // hangs from its upper end
    }
    const [px, py] = pivot
    const xs = clip.map((p) => p[0])
    const ys = clip.map((p) => p[1])
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const maxY = Math.max(...ys)
    // label beside it, on the side with more room
    const ly = clamp(cy, 96, h - 130)
    const label: Holdout['label'] =
      top >= left && top >= right
        ? { x: clamp(cx, 70, w - 70), y: clamp(maxY + 22, 96, h - 130), align: 'center' }
        : px === 0
          ? { x: Math.min(maxX + 14, w - 90), y: ly, align: 'left' }
          : { x: Math.max(minX - 14, 90), y: ly, align: 'right' }
    return {
      img: f.img,
      ox: f.x + f.ox - px,
      oy: f.y + f.oy - py,
      w: f.w,
      h: f.h,
      px,
      py,
      poly: clip.map(([x, y]) => [x - px, y - py] as Pt),
      cx: cx - px,
      cy: cy - py,
      dir: cx - px >= 0 ? 1 : -1,
      rot: 0,
      born: time,
      nextSlip: time + 0.25 + rand(0.7, 1.1),
      slip: 0,
      slipShown: 0,
      label,
      fall: null,
    }
  }

  /** Knock the holdout loose: tapped by the player, or by the slam of the next pane. */
  function knockHoldout(tapped: boolean) {
    const ho = holdout
    if (!ho || ho.fall) return
    ho.fall = { vy: 200, vr: ho.dir * 6, t0: time, py0: ho.py, tapped }
    if (tapped) {
      audio.glassHit(0.2, 0.5)
      haptic(20)
    }
  }

  function dropHoldout(tapped: boolean, silent = false) {
    const ho = holdout
    if (!ho) return
    holdout = null
    track('holdout', { tapped: tapped ? 1 : 0 })
    if (silent) return
    const c = Math.cos(ho.rot)
    const s = Math.sin(ho.rot)
    const x = ho.px + ho.cx * c - ho.cy * s
    audio.tinkle((x / stage.w) * 1.2 - 0.6)
    splinter(clamp(x, 0, stage.w), stage.h - 2, 10)
  }

  function updateHoldout(dt: number) {
    const ho = holdout
    if (!ho) return
    if (!ho.fall) {
      // settle 4 deg about the frame-side corner (250 ms, ease-out), then slip 1.5 deg now and then
      const u = clamp((time - ho.born) / 0.25, 0, 1)
      const settle = (4 * Math.PI) / 180 * (1 - (1 - u) * (1 - u) * (1 - u))
      if (time >= ho.nextSlip) {
        ho.nextSlip = time + rand(0.7, 1.1)
        ho.slip += (1.5 * Math.PI) / 180
        audio.tick(1, (ho.px / stage.w) * 1.2 - 0.6)
      }
      ho.slipShown += (ho.slip - ho.slipShown) * Math.min(1, dt * 30)
      ho.rot = ho.dir * (settle + ho.slipShown)
      return
    }
    ho.fall.vy += 2200 * dt
    ho.py += ho.fall.vy * dt
    ho.rot += ho.fall.vr * dt
    // breaks at the bottom edge
    const c = Math.cos(ho.rot)
    const s = Math.sin(ho.rot)
    let low = -Infinity
    for (const [x, y] of ho.poly) low = Math.max(low, ho.py + x * s + y * c)
    if (low >= stage.h) dropHoldout(ho.fall.tapped)
  }
  function newPane() {
    wordIdx++
    damage = 0
    rays = []
    creeps = []
    threshold = 8 + ((Math.random() * 3) | 0)
    rebuild(true)
    state = 'sliding'
    slideT = 0
    audio.whoosh(0.4)
  }

  const onDown = (e: PointerEvent) => {
    audio.unlock()
    if (!started) {
      started = true
      onFirst()
    }
    press(e.clientX, e.clientY)
  }
  function press(x: number, y: number) {
    const ho = holdout
    if (ho && !ho.fall) {
      // tap test in the shard's own frame, outline grown by 12 px
      const c = Math.cos(-ho.rot)
      const s = Math.sin(-ho.rot)
      const dx = x - ho.px
      const dy = y - ho.py
      if (nearPoly(ho.poly, dx * c - dy * s, dx * s + dy * c, 12)) return knockHoldout(true)
    }
    if (state !== 'intact') return
    hit(x, y)
  }
  canvas.addEventListener('pointerdown', onDown)
  // rAF stops in a hidden tab, so nothing would decay the critical state: silence the creak (it restarts on return if still critical)
  const onVis = () => {
    if (document.hidden) {
      creak?.stop()
      creak = null
    }
  }
  document.addEventListener('visibilitychange', onVis)

  const update = (dt: number) => {
    time += dt
    slowT = Math.min(1, slowT + dt / 0.9)
    const ts = 0.15 + 0.85 * slowT * slowT // slow-motion time scale
    const sdt = dt * ts
    if (state === 'intact' && time - lastHit > 1.2) damage = Math.max(0, damage - dt * 0.8)
    while (creeps.length && creeps[0].at <= time) {
      const k = creeps.shift()!
      creep(k.ray, k.len, k.vol)
    }
    // the last two hits: cracks creep on their own, the word flickers, the pane creaks
    const crit = state === 'intact' && damage >= threshold - 2
    if (crit) {
      if (!creak) {
        creak = audio.creak()
        critNext = time + rand(0.08, 0.2)
      }
      if (time >= critNext) {
        critNext = time + rand(0.08, 0.2)
        const live = rays.filter(onScreen)
        if (live.length) creep(live[(Math.random() * live.length) | 0], rand(5, 10), 0.6)
      }
      if (time >= flickNext) {
        flickNext = time + rand(0.05, 0.09)
        paneAlpha = rand(0.92, 1)
      }
    } else if (creak || paneAlpha !== 1) {
      creak?.stop()
      creak = null
      paneAlpha = 1
    }
    if (state === 'broken' && time - brokenAt > 1.0) newPane()
    if (state === 'sliding') {
      slideT += dt / 0.3
      if (slideT >= 1) {
        knockHoldout(false) // the slam knocks the holdout loose
        state = 'intact'
        shake.add(0.3)
        audio.glassHit(0.1)
        haptic(15)
      }
    }
    for (const f of frags) {
      f.vy += 2200 * sdt
      f.x += f.vx * sdt
      f.y += f.vy * sdt
      f.rot += f.vr * sdt
    }
    frags = frags.filter((f) => f.y - 200 < stage.h)
    updateHoldout(dt)
    let j = 0
    for (const p of slivers) {
      const d = p.slow ? sdt : dt
      p.life -= d
      if (p.life <= 0) continue
      const k = Math.pow(p.drag, d * 60)
      p.vx *= k
      p.vy = p.vy * k + p.grav * d
      p.x += p.vx * d
      p.y += p.vy * d
      p.rot += p.vr * d
      const side = Math.cos(p.rot) > 0 ? 1 : -1
      p.flash = p.glint && p.side !== 0 && side !== p.side
      p.side = side
      slivers[j++] = p
    }
    slivers.length = j
  }

  const draw = (now: number) => {
    const { ctx, w, h, dpr } = stage
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // the wall behind the glass
    ctx.fillStyle = '#040508'
    ctx.fillRect(0, 0, w, h)
    ctx.save()
    shake.apply(ctx, w, h, now)
    if (state === 'intact' || state === 'sliding') {
      const y = state === 'sliding' ? -h * (1 - easeOutBack(clamp(slideT, 0, 1))) : 0
      ctx.globalAlpha = paneAlpha
      ctx.drawImage(pane, 0, y, w, h)
      ctx.globalAlpha = 1
      if (state === 'intact') ctx.drawImage(cracks, 0, 0, w, h)
    }
    for (const f of frags) {
      ctx.save()
      ctx.translate(f.x, f.y)
      ctx.rotate(f.rot)
      ctx.drawImage((snapBlank && f.blank) || f.img, f.ox, f.oy, f.w, f.h)
      ctx.restore()
    }
    const ho = holdout
    if (ho) {
      ctx.save()
      ctx.translate(ho.px, ho.py)
      ctx.rotate(ho.rot)
      ctx.drawImage(ho.img, ho.ox, ho.oy, ho.w, ho.h)
      ctx.restore()
    }
    drawSlivers(ctx)
    ctx.restore()
    if (ho) {
      const fade = ho.fall ? 1 - clamp((time - ho.fall.t0) / 0.15, 0, 1) : clamp((time - ho.born - 0.5) / 0.15, 0, 1)
      if (fade > 0) {
        ctx.font = `600 13px ${FONT}`
        ctx.textAlign = ho.label.align
        ctx.textBaseline = 'middle'
        ctx.fillStyle = `rgba(235,248,255,${0.8 * fade})`
        ctx.shadowColor = `rgba(0,0,0,${0.6 * fade})`
        ctx.shadowBlur = 6
        ctx.fillText(t('smash_holdout'), ho.label.x, ho.label.y + (ho.fall ? ho.py - ho.fall.py0 : 0))
        ctx.shadowBlur = 0
        ctx.textBaseline = 'alphabetic'
      }
    }
    if (smashed > 0) {
      ctx.font = `600 13px ${FONT}`
      ctx.textAlign = 'left'
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillText(smashed === 1 ? t('smash_count_one') : t('smash_count', { n: smashed }), 40, h - 40)
    }
    flash.draw(ctx, w, h)
  }

  function drawSlivers(ctx: CanvasRenderingContext2D) {
    if (!slivers.length) return
    for (const glint of [false, true]) {
      ctx.fillStyle = glint ? '#fff' : `rgb(${SLIVER_RGB})`
      for (const p of slivers) {
        if (p.flash !== glint) continue
        ctx.globalAlpha = (glint ? 1 : 0.9) * Math.min(1, (p.life / p.max) * 1.5)
        const c = Math.cos(p.rot)
        const s = Math.sin(p.rot)
        const hl = p.l / 2
        const hw = p.w / 2
        ctx.beginPath()
        ctx.moveTo(p.x + c * hl, p.y + s * hl)
        ctx.lineTo(p.x - c * hl - s * hw, p.y - s * hl + c * hw)
        ctx.lineTo(p.x - c * hl + s * hw, p.y - s * hl - c * hw)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }

  const step = (dt: number) => {
    update(dt)
    shake.update(dt)
    flash.update(dt)
  }
  /** The card's picture: this frame (the word left off if it is a sender's), then the frame as shown. */
  function peakSnap(now: number) {
    snapAt = 0
    const blank = frags.some((f) => f.blank)
    if (blank) {
      snapBlank = true
      draw(now)
      snapBlank = false
    }
    const k = Math.min(1, 1000 / canvas.width)
    const out = makeCanvas(canvas.width * k, canvas.height * k)
    out.getContext('2d')!.drawImage(canvas, 0, 0, out.width, out.height)
    if (blank) draw(now)
    onPeak?.(out)
  }
  const stopLoop = runLoop((dt, now) => {
    if (frozen) return
    if (!stop.active) step(dt)
    draw(now)
    if (snapAt && time >= snapAt) peakSnap(now)
  })

  if (import.meta.env.DEV) {
    const n = Number(QS.get('damage') || 0)
    for (let i = 0; i < Math.min(n, threshold - 1); i++) {
      damage++
      crackAt(rand(0.2, 0.8) * stage.w, rand(0.25, 0.75) * stage.h, damage / threshold)
    }
    lastHit = time
    ;(window as unknown as Record<string, unknown>).__toy = {
      freeze: () => (frozen = true),
      unfreeze: () => (frozen = false),
      /** Step the sim by `ms` (in 1/60 s slices) and redraw; hit-stop is skipped. */
      advance(ms: number) {
        for (let left = ms / 1000; left > 1e-6; left -= 1 / 60) step(Math.min(1 / 60, left))
        draw(time * 1000)
      },
      hit: (x: number, y: number) => {
        audio.unlock()
        if (!started) {
          started = true
          onFirst()
        }
        press(x, y)
        if (frozen) draw(time * 1000)
      },
      seed: QS.get('seed'),
      state: () => {
        const ho = holdout
        const at = ho && { x: ho.px + ho.cx * Math.cos(ho.rot) - ho.cy * Math.sin(ho.rot), y: ho.py + ho.cx * Math.sin(ho.rot) + ho.cy * Math.cos(ho.rot) }
        return { state, damage, threshold, smashed, holdout: !!ho, falling: !!ho?.fall, at, time, ho: ho && { px: ho.px, py: ho.py, label: ho.label, poly: ho.poly.map(([x, y]) => [Math.round(x + ho.px), Math.round(y + ho.py)]) } }
      },
    }
  }

  return {
    dispose() {
      stopLoop()
      dispose()
      creak?.stop()
      document.removeEventListener('visibilitychange', onVis)
      canvas.removeEventListener('pointerdown', onDown)
    },
    setWords(words: string[]) {
      customWords = words
      wordIdx = 0
      if (state === 'intact') {
        // repaint the word but keep the cracks
        const { w, h, dpr } = stage
        drawPane(pane.getContext('2d')!, w, h, dpr)
      }
    },
  }
}
