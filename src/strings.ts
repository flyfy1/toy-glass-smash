// Glass Smash: this toy's own interface text in five languages (toy-specific, not a shared file).
// The text every toy shares (names for the More menu, Share, About) lives in i18n.ts.

const en = {
  smash_tag: "Someone left you this. Smash it.",
  smash_reply_ph: "Their least favourite word",
  desc_smash: "A pane of tempered glass with the word you hate on it. Smash it. Ten fast hits and it bursts into slow-motion shards. A tiny stress-relief toy, no sign-up.",
  hint_smash: "Tap to smash · hit fast to shatter it all",
  smash_placeholder: "✎ Annoying words, comma-separated",
  smash_count: "{n} panes smashed",
  smash_words: ["MONDAY", "DEADLINE", "BUG", "MEETINGS", "OVERTIME", "REPLY ALL", "TRAFFIC", "TAXES", "RENT", "SPAM", "CAPTCHA", "LOW BATTERY", "POP-UP ADS", "KPI"],
  smash_holdout: "Still here.",
  smash_count_one: "1 pane smashed",
  share_smash: "🔨 Write the word you hate on glass, then smash it:",
  share_smash_words: "🔨 I just smashed “{w}” to pieces. Smash them with me:",
}

const zhCN: typeof en = {
  smash_tag: "有人留了块玻璃给你。砸。",
  smash_reply_ph: "写上 TA 最烦的词",
  desc_smash: "一块钢化玻璃，上面写着让你烦的词：BUG、加班、暴跌……砸它。连击十下整块炸成碎片慢动作飘落。打开即玩的解压小玩具。",
  hint_smash: "点击砸玻璃 · 连砸十下整块粉碎",
  smash_placeholder: "✎ 烦人的词，用逗号分隔",
  smash_count: "已砸碎 {n} 块",
  smash_words: ["加班", "周一", "BUG", "KPI", "改需求", "甲方", "内卷", "周报", "已读不回", "早高峰", "房贷", "调休", "暴跌", "催婚"],
  smash_holdout: "钉子户。",
  smash_count_one: "已砸碎 1 块",
  share_smash: "🔨 把让你烦的词写在玻璃上，然后砸碎它：",
  share_smash_words: "🔨 我刚把「{w}」砸得粉碎，一起来砸：",
}

const es: typeof en = {
  smash_tag: "Alguien te ha dejado esto. Rómpelo.",
  smash_reply_ph: "Su palabra más odiada",
  desc_smash: "Un cristal templado con la palabra que odias. Rómpelo. Diez golpes rápidos y estalla en pedazos a cámara lenta. Un juguete antiestrés, sin registro.",
  hint_smash: "Toca para golpear · golpea rápido para romperlo todo",
  smash_placeholder: "✎ Lo que te molesta (con comas)",
  smash_count: "{n} cristales rotos",
  smash_words: ["LUNES", "HORAS EXTRA", "REUNIONES", "ATASCO", "HACIENDA", "ALQUILER", "MADRUGAR", "BUG", "SPAM", "CUÑADOS", "DEADLINE", "RESACA"],
  smash_holdout: "Ahí sigue.",
  smash_count_one: "1 cristal roto",
  share_smash: "🔨 Escribe la palabra que odias en un cristal y rómpelo:",
  share_smash_words: "🔨 Acabo de hacer añicos «{w}». Rómpelo conmigo:",
}

const fr: typeof en = {
  smash_tag: "Quelqu’un vous a laissé ça. Cassez-la.",
  smash_reply_ph: "Son mot le plus détesté",
  desc_smash: "Une vitre trempée avec le mot que tu détestes. Casse-la. Dix coups rapides et elle vole en éclats au ralenti. Un petit jouet anti-stress, sans inscription.",
  hint_smash: "Touche pour frapper · frappe vite pour tout briser",
  smash_placeholder: "✎ Ce qui t’énerve (virgules)",
  smash_count: "{n} vitres cassées",
  smash_words: ["LUNDI", "RÉUNIONS", "BOUCHONS", "GRÈVE", "IMPÔTS", "LOYER", "PAPERASSE", "RER B", "HEURES SUP", "BUG", "SPAM", "DEADLINE"],
  smash_holdout: "Toujours là.",
  smash_count_one: "1 vitre cassée",
  share_smash: "🔨 Écris le mot que tu détestes sur une vitre, puis casse-la :",
  share_smash_words: "🔨 Je viens de réduire « {w} » en miettes. Viens casser avec moi :",
}

const ja: typeof en = {
  smash_tag: "あなた宛てのガラスです。割ってどうぞ。",
  smash_reply_ph: "相手がいちばん嫌いな言葉",
  desc_smash: "ムカつく言葉が書かれた強化ガラス。叩き割ろう。素早く 10 連打でスローモーションで粉々に。登録不要のストレス解消おもちゃ。",
  hint_smash: "タップで叩く · 連打でガラスを粉々に",
  smash_placeholder: "✎ ムカつく言葉（カンマ区切り）",
  smash_count: "{n} 枚粉砕",
  smash_words: ["残業", "月曜日", "満員電車", "締め切り", "会議", "ノルマ", "上司", "飲み会", "ハンコ", "稟議", "バグ", "サービス残業"],
  smash_holdout: "しぶとい。",
  smash_count_one: "1 枚粉砕",
  share_smash: "🔨 ムカつく言葉をガラスに書いて、叩き割ろう：",
  share_smash_words: "🔨 「{w}」を粉々にした。一緒に割ろう：",
}

export default { en, 'zh-CN': zhCN, es, fr, ja }
