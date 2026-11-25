import { useEffect, useRef, useState } from 'react'
import { MoreMenu } from './components/MoreMenu'
import { applyMeta, t } from './i18n'
import { startAnalytics, track } from './analytics'
import { parseWords, stats, syncWordsToUrl, wordsFromUrl } from './share'
import { Hint } from './components/Hint'
import { startGame, type GameApi } from './game'

export default function App() {
  const ref = useRef<HTMLCanvasElement>(null)
  const api = useRef<GameApi | null>(null)
  const urlTimer = useRef<number | undefined>(undefined)
  const [touched, setTouched] = useState(false)
  // Words from a shared link (?w=BUG,加班) pre-fill the box and the glass.
  const [initial] = useState(() => wordsFromUrl())
  const [text, setText] = useState(() => initial.join(', '))
  useEffect(() => {
    applyMeta('smash')
    startAnalytics('smash')
    stats.words = initial
    if (initial.length) track('shared_words_open', { words: initial.length })
    const g = startGame(
      ref.current!,
      () => {
        setTouched(true)
        track('play_start')
      },
      initial,
    )
    api.current = g
    return () => g.dispose()
  }, [initial])
  const onText = (value: string) => {
    setText(value)
    const words = parseWords(value)
    stats.words = words
    api.current?.setWords(words)
    window.clearTimeout(urlTimer.current)
    urlTimer.current = window.setTimeout(() => syncWordsToUrl(words), 300)
  }
  return (
    <>
      <canvas ref={ref} />
      <input
        value={text}
        maxLength={140}
        placeholder={t('smash_placeholder')}
        enterKeyHint="done"
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="fixed left-1/2 top-3 z-20 w-80 max-w-[86vw] -translate-x-1/2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-center text-base text-white placeholder-white/45 placeholder:text-sm outline-none backdrop-blur-md focus:border-white/40 focus:bg-white/20"
      />
      <Hint text={t('hint_smash')} hidden={touched} />
      <MoreMenu current="smash" />
    </>
  )
}
