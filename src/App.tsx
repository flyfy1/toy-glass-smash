import { useEffect, useRef, useState } from 'react'
import { MoreMenu } from './components/MoreMenu'
import { applyMeta, t } from './i18n'
import { startAnalytics, track } from './analytics'
import { Hint } from './components/Hint'
import { startGame, type GameApi } from './game'

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null)
  const api = useRef<GameApi | null>(null)
  const [touched, setTouched] = useState(false)
  const [word, setWord] = useState('')
  useEffect(() => {
    applyMeta('smash')
    startAnalytics('smash')
    const g = startGame(ref.current!, () => {
      setTouched(true)
      track('play_start')
    })
    api.current = g
    return () => g.dispose()
  }, [])
  return (
    <>
      <canvas ref={ref} />
      <input
        value={word}
        maxLength={12}
        placeholder={t('smash_placeholder')}
        enterKeyHint="done"
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          setWord(e.target.value)
          api.current?.setWord(e.target.value)
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="fixed left-1/2 top-3 z-20 w-60 max-w-[70vw] -translate-x-1/2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-center text-base text-white placeholder-white/45 outline-none backdrop-blur-md focus:border-white/40 focus:bg-white/20"
      />
      <Hint text={t('hint_smash')} hidden={touched} />
      <MoreMenu current="smash" />
    </>
  )
}
