import { audio } from './engine/AudioEngine'
import { track } from './analytics'
import { locale, smashWords, t } from './i18n'
import { type Stage, Flash, HitStop, Particles, Shake, clamp, easeOutBack, haptic, rand, runLoop, setupCanvas } from './engine/juice'

const DEFAULT_WORDS = smashWords()
const FONT = locale === 'ja' ? 'system-ui, "Hiragino Sans", "Noto Sans CJK JP", sans-serif' : 'system-ui, "PingFang SC", "Hiragino Sans", "Noto Sans CJK SC", sans-serif'

interface Frag {
  img: HTMLCanvasElement
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

export function startGame(canvas: HTMLCanvasElement, onFirst: () => void, initialWords: string[] = []): GameApi {
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

  const { stage, dispose } = setupCanvas(canvas, (s) => rebuild(true, s))
  const shake = new Shake(30, 0.04, 1.7)
  const stop = new HitStop()
  const flash = new Flash()
  const parts = new Particles(2500)
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

  function rebuild(clearCracks: boolean, s: Stage = stage) {
    const { w, h, dpr } = s
    pane = makeCanvas(w * dpr, h * dpr)
    drawPane(pane.getContext('2d')!, w, h, dpr)
    if (clearCracks || cracks.width !== pane.width || cracks.height !== pane.height) cracks = makeCanvas(w * dpr, h * dpr)
  }

  function drawPane(c: CanvasRenderingContext2D, w: number, h: number, dpr: number) {
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    const bg = c.createLinearGradient(0, 0, w, h)
    bg.addColorStop(0, '#1b2740')
    bg.addColorStop(1, '#0a0f1c')
    c.fillStyle = bg
    c.fillRect(0, 0, w, h)
    // the annoying word
    const text = word()
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

  function crackAt(x: number, y: number, power: number) {
    const c = cracks.getContext('2d')!
    const dpr = stage.dpr
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.lineCap = 'round'
    const n = (9 + Math.random() * 6) | 0
    const ends: { a: number; pts: [number, number][] }[] = []
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
      ends.push({ a, pts })
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
    crackAt(x, y, p)
    audio.glassHit(0.25 + 0.75 * p)
    shake.add(0.28 + 0.3 * p)
    stop.trigger(16 + 20 * p)
    flash.fire(0.12 + 0.1 * p, '220,240,255')
    haptic(20 + Math.round(30 * p))
    parts.burst(x, y, 26 + damage * 4, { speed: 700, hue: 200, light: 88, life: 0.6, size: 3.5, grav: 2200, drag: 0.97 })
  }

  function shatter(x: number, y: number) {
    const { w, h, dpr } = stage
    crackAt(x, y, 1)
    const snap = makeCanvas(w * dpr, h * dpr)
    const sc = snap.getContext('2d')!
    sc.drawImage(pane, 0, 0)
    sc.drawImage(cracks, 0, 0)

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
        const img = makeCanvas(fw * dpr, fh * dpr)
        const c = img.getContext('2d')!
        c.setTransform(dpr, 0, 0, dpr, -minX * dpr, -minY * dpr)
        c.beginPath()
        poly.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)))
        c.closePath()
        c.save()
        c.clip()
        c.setTransform(1, 0, 0, 1, 0, 0)
        c.drawImage(snap, -minX * dpr, -minY * dpr)
        c.restore()
        c.strokeStyle = 'rgba(220,245,255,0.7)'
        c.lineWidth = 1.2
        c.stroke()
        const dx = cx - x
        const dy = cy - y
        const dist = Math.hypot(dx, dy) + 1
        const near = 1 - clamp(dist / D, 0, 1)
        const sp = 250 + 1300 * near * near + rand(0, 200)
        frags.push({
          img,
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
      }
    state = 'broken'
    brokenAt = time
    slowT = 0
    smashed++
    track('shatter', { panes: smashed })
    stop.trigger(60)
    flash.fire(0.9, '235,245,255')
    shake.add(1)
    haptic([40, 30, 120, 40, 200])
    audio.shatter()
    parts.burst(x, y, 380, { speed: 1600, hue: () => rand(185, 215), light: 85, life: 1.6, size: 4, grav: 1800, drag: 0.975 })
  }

  function newPane() {
    wordIdx++
    damage = 0
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
    if (state !== 'intact') return
    hit(e.clientX, e.clientY)
  }
  canvas.addEventListener('pointerdown', onDown)

  const update = (dt: number) => {
    time += dt
    slowT = Math.min(1, slowT + dt / 0.9)
    const ts = 0.15 + 0.85 * slowT * slowT // slow-motion time scale
    const sdt = dt * ts
    if (state === 'intact' && time - lastHit > 1.2) damage = Math.max(0, damage - dt * 0.8)
    if (state === 'broken' && time - brokenAt > 1.0) newPane()
    if (state === 'sliding') {
      slideT += dt / 0.3
      if (slideT >= 1) {
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
    parts.update(sdt)
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
      ctx.drawImage(pane, 0, y, w, h)
      if (state === 'intact') ctx.drawImage(cracks, 0, 0, w, h)
    }
    for (const f of frags) {
      ctx.save()
      ctx.translate(f.x, f.y)
      ctx.rotate(f.rot)
      ctx.drawImage(f.img, f.ox, f.oy, f.w, f.h)
      ctx.restore()
    }
    parts.draw(ctx)
    ctx.restore()
    if (smashed > 0) {
      ctx.font = '600 12px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillStyle = 'rgba(255,255,255,0.4)'
      ctx.fillText(t('smash_count', { n: smashed }), 36, h - 34)
    }
    flash.draw(ctx, w, h)
  }

  const stopLoop = runLoop((dt, now) => {
    if (!stop.active) {
      update(dt)
      shake.update(dt)
      flash.update(dt)
    }
    draw(now)
  })

  return {
    dispose() {
      stopLoop()
      dispose()
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
