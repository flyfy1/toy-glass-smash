import { useEffect, useRef, useState } from 'react'
import { MoreMenu } from './components/MoreMenu'
import { applyMeta, t } from './i18n'
import { startAnalytics, track } from './analytics'
import { landing, live, openSheet, parseWords, sharePeak, stats, store, syncWordsToUrl, trackLanding, wordsFromUrl } from './share'
import { Tag } from './components/Tag'
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
  // a recipient answering: the box opens empty, with its own placeholder; done typing, the sheet comes back
  const box = useRef<HTMLInputElement>(null)
  const [ph, setPh] = useState('')
  useEffect(() => {
    applyMeta('smash')
    // a link with something in it: the title (what WeChat shows when it is forwarded) says so
    if (landing.recipient) document.title = t('smash_tag')
    startAnalytics('smash')
    stats.words = initial
    trackLanding({ words: initial.length })
    const g = startGame(
      ref.current!,
      () => {
        setTouched(true)
        track('play_start')
      },
      initial,
      (snap) => {
        // a card (with a picture) at the 1st, 5th, 20th and 50th pane; in between the numbers keep up
        const peak = { snap, data: { panes: stats.n ?? 0 } }
        if (snap) sharePeak('smash', peak)
        else store.peak = peak
      },
      landing.recipient ? initial : [],
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
  live.reply = () => {
    onText('')
    setPh(t('smash_reply_ph'))
    box.current?.focus()
  }
  const sendReply = () => {
    if (!ph || !parseWords(text).length) return
    setPh('')
    window.clearTimeout(urlTimer.current)
    syncWordsToUrl(parseWords(text))
    openSheet('reply')
  }
  return (
    <>
      <canvas ref={ref} />
      <input
        ref={box}
        value={text}
        maxLength={140}
        placeholder={ph || t('smash_placeholder')}
        onBlur={sendReply}
        enterKeyHint="done"
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="fixed left-1/2 top-3 z-20 w-80 max-w-[86vw] -translate-x-1/2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-center text-base text-white placeholder-white/45 placeholder:text-sm outline-none backdrop-blur-md focus:border-white/40 focus:bg-white/20"
      />
      <Hint text={t('hint_smash')} hidden={touched} />
      {landing.recipient && <Tag text={t('smash_tag')} className="top-16" paper="bg-[#F4F1EA] text-[#B3261E] font-semibold" />}
      <MoreMenu current="smash" />
    </>
  )
}
