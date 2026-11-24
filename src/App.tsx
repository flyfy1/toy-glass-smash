import { useEffect, useRef, useState } from 'react'
import { MoreMenu } from './components/MoreMenu'
import { Hint } from './components/Hint'
import { startGame, type GameApi } from './game'

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null)
  const api = useRef<GameApi | null>(null)
  const [touched, setTouched] = useState(false)
  const [word, setWord] = useState('')
  useEffect(() => {
    const g = startGame(ref.current!, () => setTouched(true))
    api.current = g
    return () => g.dispose()
  }, [])
  return (
    <>
      <canvas ref={ref} />
      <input
        value={word}
        maxLength={12}
        placeholder="✎ 换成让你烦的词"
        enterKeyHint="done"
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          setWord(e.target.value)
          api.current?.setWord(e.target.value)
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="fixed left-1/2 top-3 z-20 w-48 -translate-x-1/2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-center text-base text-white placeholder-white/45 outline-none backdrop-blur-md focus:border-white/40 focus:bg-white/20"
      />
      <Hint text="点击砸玻璃 · 连砸十下整块粉碎" hidden={touched} />
      <MoreMenu current="smash" />
    </>
  )
}
