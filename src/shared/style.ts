/**
 * Turns a free-form (often Russian) description into the English style tags ACE-Step's DiT understands.
 *
 * Why: the DiT text encoder was trained on English captions — Russian prose makes it fall back to generic
 * hip-hop/pop, and the 5 Hz LM (create_sample / CoT caption) reinterprets long non-English descriptions
 * the same way. Pulling out genres, instruments, moods and tempo keeps the user's style intact.
 */

type Kind = 'genre' | 'inst' | 'mood' | 'vocal' | 'era'
/** [pattern, English tag, kind, instrumental-by-nature]. Patterns match at a word start; `$` ends an alternative at a word end. */
type Term = [string, string, Kind, boolean?]

const TERMS: Term[] = [
  // Genres — specific first; shorter tags contained in a longer match are dropped later.
  ['дарк[- ]?джаз', 'dark jazz', 'genre', true],
  ['дум[- ]?джаз', 'doom jazz', 'genre', true],
  ['нуар[- ]?джаз|джаз[- ]?нуар', 'noir jazz', 'genre'],
  ['нуар', 'film noir', 'mood'],
  ['фри[- ]?джаз', 'free jazz', 'genre'],
  ['эйсид[- ]?джаз|эсид[- ]?джаз', 'acid jazz', 'genre'],
  ['смус[- ]?джаз|смут[- ]?джаз', 'smooth jazz', 'genre'],
  ['джаз', 'jazz', 'genre'],
  ['свинг', 'swing', 'genre'],
  ['бибоп|би-боп', 'bebop', 'genre'],
  ['биг[- ]?бэнд|биг[- ]?бенд', 'big band', 'genre'],
  ['фьюжн', 'fusion', 'genre'],
  ['блюз', 'blues', 'genre'],
  ['соул', 'soul', 'genre'],
  ['госпел', 'gospel', 'genre'],
  ['фанк(?!ц)', 'funk', 'genre'],
  ['диско', 'disco', 'genre'],
  ['ритм[- ]?(н|энд|and)[- ]?блюз|рнб$|эр[- ]?эн[- ]?би', 'R&B', 'genre'],
  ['дум[- ]?метал', 'doom metal', 'genre'],
  ['блэк[- ]?метал|блек[- ]?метал', 'black metal', 'genre'],
  ['дэт[- ]?метал|дэз[- ]?метал|дез[- ]?метал', 'death metal', 'genre'],
  ['ню[- ]?метал', 'nu metal', 'genre'],
  ['пауэр[- ]?метал', 'power metal', 'genre'],
  ['метал[- ]?кор|металкор', 'metalcore', 'genre'],
  ['хэви|хеви', 'heavy metal', 'genre'],
  ['метал(?!л[иуо])', 'metal', 'genre'],
  ['пост[- ]?рок', 'post-rock', 'genre', true],
  ['пост[- ]?панк', 'post-punk', 'genre'],
  ['поп[- ]?панк', 'pop punk', 'genre'],
  ['панк', 'punk', 'genre'],
  ['гранж', 'grunge', 'genre'],
  ['шугейз|шугейзинг', 'shoegaze', 'genre'],
  ['прог(рессив)?[- ]?рок|прогрессив', 'progressive rock', 'genre'],
  ['психодел', 'psychedelic', 'genre'],
  ['рок[- ]?н[- ]?ролл|рокн?ролл', "rock 'n' roll", 'genre'],
  ['хард[- ]?рок', 'hard rock', 'genre'],
  ['альт[- ]?рок|альтернатив', 'alternative rock', 'genre'],
  ['инди', 'indie', 'genre'],
  ['рок(а|у|ом|е)?$', 'rock', 'genre'],
  ['эмо$', 'emo', 'genre'],
  ['готик|готическ', 'gothic', 'genre'],
  ['дарк[- ]?вейв|дарквейв', 'darkwave', 'genre'],
  ['нью[- ]?вейв', 'new wave', 'genre'],
  ['синт[- ]?поп', 'synth-pop', 'genre'],
  ['кей[- ]?поп|к-поп', 'K-pop', 'genre'],
  ['джей[- ]?поп', 'J-pop', 'genre'],
  ['поп[- ]?рок', 'pop rock', 'genre'],
  ['поп(а|са|сы|е)?$|поп-', 'pop', 'genre'],
  ['хип[- ]?хоп', 'hip-hop', 'genre'],
  ['рэп|реп(?![а-я])', 'rap', 'genre'],
  ['трэп|треп(?![а-я])', 'trap', 'genre'],
  ['дрилл', 'drill', 'genre'],
  ['фонк', 'phonk', 'genre'],
  ['бум[- ]?бэп|бумбэп', 'boom bap', 'genre'],
  ['лоу[- ]?фай|лофай|лоуфай', 'lo-fi', 'genre'],
  ['чилл[- ]?хоп|чиллхоп', 'chillhop', 'genre'],
  ['трип[- ]?хоп', 'trip-hop', 'genre'],
  ['даун[- ]?темпо', 'downtempo', 'genre'],
  ['чил+[- ]?аут', 'chillout', 'genre'],
  ['эмбиент|амбиент|эмбиэнт', 'ambient', 'genre', true],
  ['дарк[- ]?эмбиент', 'dark ambient', 'genre', true],
  ['дрон(?![а-я])|дроун', 'drone', 'genre', true],
  ['нью[- ]?эйдж', 'new age', 'genre', true],
  ['электрон', 'electronic', 'genre'],
  ['техно', 'techno', 'genre'],
  ['дип[- ]?хаус', 'deep house', 'genre'],
  ['хаус', 'house', 'genre'],
  ['транс(?!ф|п|л)', 'trance', 'genre'],
  ['дабстеп', 'dubstep', 'genre'],
  ['драм[- ]?(н|энд|and)[- ]?бейс|днб$|драмбейс', 'drum and bass', 'genre'],
  ['брейкбит', 'breakbeat', 'genre'],
  ['джангл', 'jungle', 'genre'],
  ['хардстайл', 'hardstyle', 'genre'],
  ['габбер', 'gabber', 'genre'],
  ['электро(?!н|[- ]?гитар|[- ]?пиан)', 'electro', 'genre'],
  ['индастриал', 'industrial', 'genre'],
  ['синт[- ]?вейв|синтвэйв', 'synthwave', 'genre'],
  ['ретро[- ]?вейв', 'retrowave', 'genre'],
  ['вейпор[- ]?вейв', 'vaporwave', 'genre'],
  ['чиптюн|8[- ]?бит', 'chiptune', 'genre', true],
  ['idm$', 'IDM', 'genre'],
  ['классик|классическ[а-я]* музык|академическ', 'classical', 'genre', true],
  ['барокко', 'baroque', 'genre', true],
  ['симфони', 'symphonic', 'genre'],
  ['оркестр', 'orchestral', 'genre'],
  ['саундтрек|киномузык|музык[а-я]* для (фильм|кино)', 'film score', 'genre', true],
  ['кинематограф', 'cinematic', 'mood'],
  ['опер(а|ы|е|ой|ный|ная)?$', 'opera', 'genre'],
  ['фолк|народн', 'folk', 'genre'],
  ['кантри', 'country', 'genre'],
  ['блюграсс', 'bluegrass', 'genre'],
  ['рэгги|регги', 'reggae', 'genre'],
  ['ска$', 'ska', 'genre'],
  ['даб$', 'dub', 'genre'],
  ['латино|латин', 'latin', 'genre'],
  ['сальс', 'salsa', 'genre'],
  ['босс?а[- ]?нов', 'bossa nova', 'genre'],
  ['самб', 'samba', 'genre'],
  ['танго', 'tango', 'genre'],
  ['фламенко', 'flamenco', 'genre'],
  ['регетон|реггетон', 'reggaeton', 'genre'],
  ['афро[- ]?бит', 'afrobeat', 'genre'],
  ['кельт', 'celtic', 'genre'],
  ['шансон', 'chanson', 'genre'],
  ['романс', 'romance ballad', 'genre'],
  ['баллад', 'ballad', 'genre'],
  ['колыбельн', 'lullaby', 'genre'],
  ['вальс', 'waltz', 'genre'],
  ['марш(?![рм])', 'march', 'genre'],
  ['гимн', 'anthem', 'genre'],
  ['восточн', 'middle eastern', 'genre'],
  ['арабск', 'arabic', 'genre'],
  ['индийск', 'indian', 'genre'],
  ['японск', 'japanese', 'genre'],
  ['китайск', 'chinese', 'genre'],
  ['славянск', 'slavic folk', 'genre'],
  ['рождеств|новогодн', 'christmas', 'genre'],
  ['видеоигр|игров[а-я]* музык', 'video game music', 'genre'],
  ['медитат|медитац', 'meditative', 'mood', true],

  // Instruments.
  ['приглуш[её]нн[а-я]* труб|труб[а-я]* с сурдин', 'muted trumpet', 'inst'],
  ['труб(а|ы|у|ой|е|ач)?$', 'trumpet', 'inst'],
  ['саксофон|сакс$', 'saxophone', 'inst'],
  ['тромбон', 'trombone', 'inst'],
  ['кларнет', 'clarinet', 'inst'],
  ['флейт', 'flute', 'inst'],
  ['гобо', 'oboe', 'inst'],
  ['фагот', 'bassoon', 'inst'],
  ['валторн', 'french horn', 'inst'],
  ['туба$|тубы$', 'tuba', 'inst'],
  ['духов', 'brass section', 'inst'],
  ['контрабас', 'upright bass', 'inst'],
  ['бас[- ]?гитар', 'bass guitar', 'inst'],
  ['слэп|слеп', 'slap bass', 'inst'],
  ['808', '808 bass', 'inst'],
  ['бас(ы|ов|ом)?$|басов', 'bass', 'inst'],
  ['электро[- ]?гитар|электрогитар', 'electric guitar', 'inst'],
  ['акустическ[а-я]* гитар', 'acoustic guitar', 'inst'],
  ['классическ[а-я]* гитар|нейлон', 'nylon guitar', 'inst'],
  ['перегруж|дисторш|овердрайв|дисторшн', 'distorted guitar', 'inst'],
  ['гитар', 'guitar', 'inst'],
  ['щ[её]тк', 'brushed drums', 'inst'],
  ['мал(ый|ому|ом|ого) барабан|снейр', 'snare', 'inst'],
  ['драм[- ]?машин', 'drum machine', 'inst'],
  ['живы[ех] барабан|живые ударн', 'live drums', 'inst'],
  ['барабан|ударн', 'drums', 'inst'],
  ['бочк', 'kick drum', 'inst'],
  ['перкусс', 'percussion', 'inst'],
  ['литавр', 'timpani', 'inst'],
  ['конг|бонго', 'congas', 'inst'],
  ['тарелк', 'cymbals', 'inst'],
  ['скрипк|скрипич', 'violin', 'inst'],
  ['виолончел', 'cello', 'inst'],
  ['струнн', 'strings', 'inst'],
  ['арф', 'harp', 'inst'],
  ['фортепиан|пианино|рояль|рояля', 'piano', 'inst'],
  ['электропиан|родес|rhodes', 'Rhodes electric piano', 'inst'],
  ['синтезатор|синт$|синты', 'synthesizer', 'inst'],
  ['аналогов[а-я]* синт', 'analog synth', 'inst'],
  ['пэд|пады$', 'synth pads', 'inst'],
  ['орган(?!из|ич)', 'organ', 'inst'],
  ['клавиш', 'keys', 'inst'],
  ['аккордеон|баян|гармон(ь|ик|ики)', 'accordion', 'inst'],
  ['губн[а-я]* гармош', 'harmonica', 'inst'],
  ['вибрафон', 'vibraphone', 'inst'],
  ['ксилофон|маримб', 'marimba', 'inst'],
  ['колокол', 'bells', 'inst'],
  ['ситар', 'sitar', 'inst'],
  ['балалайк', 'balalaika', 'inst'],
  ['домр', 'domra', 'inst'],
  ['гусл', 'gusli', 'inst'],
  ['волынк', 'bagpipes', 'inst'],
  ['укулеле', 'ukulele', 'inst'],
  ['банджо', 'banjo', 'inst'],
  ['мандолин', 'mandolin', 'inst'],
  ['семпл|сэмпл', 'samples', 'inst'],
  ['скрэтч|скретч|скрейтч', 'turntable scratches', 'inst'],

  // Vocals.
  ['мужск[а-я]* (вокал|голос)', 'male vocals', 'vocal'],
  ['женск[а-я]* (вокал|голос)', 'female vocals', 'vocal'],
  ['детск[а-я]* (вокал|голос|хор)', "children's choir", 'vocal'],
  ['хор(ы|ом|а|овой|ал)?$', 'choir', 'vocal'],
  ['ш[её]пот', 'whispered vocals', 'vocal'],
  ['речитатив|мелодекламац|спокен', 'spoken word', 'vocal'],
  ['фальцет', 'falsetto', 'vocal'],
  ['скрим|гроул|гроулинг|экстрим[а-я]* вокал', 'screamed vocals', 'vocal'],
  ['бэк[- ]?вокал', 'backing vocals', 'vocal'],
  ['автотюн', 'autotune vocals', 'vocal'],

  // Moods, atmosphere, texture.
  ['мрачн', 'dark', 'mood'],
  ['т[её]мн', 'dark', 'mood'],
  ['гнетущ|давящ', 'oppressive', 'mood'],
  ['погребальн|похоронн|траурн', 'funereal', 'mood'],
  ['атмосферн', 'atmospheric', 'mood'],
  ['меланхол', 'melancholic', 'mood'],
  ['грустн|печальн', 'sad', 'mood'],
  ['тоскл|тоск', 'wistful', 'mood'],
  ['ностальг', 'nostalgic', 'mood'],
  ['романтич', 'romantic', 'mood'],
  ['нежн', 'tender', 'mood'],
  ['спокойн|умиротвор', 'calm', 'mood'],
  ['расслабл|релакс', 'relaxing', 'mood'],
  ['мечтат|сновид', 'dreamy', 'mood'],
  ['воздушн', 'airy', 'mood'],
  ['космическ|космос', 'spacey', 'mood'],
  ['таинствен|загадочн|мистическ', 'mysterious', 'mood'],
  ['тревожн|напряж[её]н', 'tense', 'mood'],
  ['зловещ|угрожающ', 'ominous', 'mood'],
  ['жутк|страшн|хоррор|ужас', 'eerie horror', 'mood'],
  ['эпичн|эпическ', 'epic', 'mood'],
  ['величеств', 'majestic', 'mood'],
  ['торжеств', 'triumphant', 'mood'],
  ['героич', 'heroic', 'mood'],
  ['драматич', 'dramatic', 'mood'],
  ['агрессивн|яростн|жёстк|жестк', 'aggressive', 'mood'],
  ['энергичн|драйвов|мощн', 'energetic', 'mood'],
  ['бодр', 'upbeat', 'mood'],
  ['вес[её]л', 'cheerful', 'mood'],
  ['радостн|счастлив', 'happy', 'mood'],
  ['позитивн', 'positive', 'mood'],
  ['танцевальн|танцпол', 'danceable', 'mood'],
  ['игрив', 'playful', 'mood'],
  ['чувственн|сексуальн', 'sensual', 'mood'],
  ['интимн', 'intimate', 'mood'],
  ['лиричн|лирическ', 'lyrical', 'mood'],
  ['гипнотич', 'hypnotic', 'mood'],
  ['экспериментальн', 'experimental', 'mood'],
  ['минимал', 'minimal', 'mood'],
  ['дымн|прокурен', 'smoky', 'mood'],
  ['ночн|полуноч', 'late night', 'mood'],
  ['дожд', 'rainy', 'mood'],
  ['городск|урбан', 'urban', 'mood'],
  ['летн', 'summer', 'mood'],
  ['зимн', 'winter', 'mood'],
  ['осенн|осен', 'autumn', 'mood'],
  ['т[её]пл', 'warm', 'mood'],
  ['холодн', 'cold', 'mood'],
  ['живо[йм] звук|живые инструмент', 'live instruments', 'mood'],
  ['ревер[бп]|эхо', 'reverb-drenched', 'mood'],
  ['винтаж|ретро', 'vintage', 'era'],
  ['олд[- ]?скул', 'old school', 'era'],
  ['(19)?20[- ]?х(?![а-я]| год)', '1920s', 'era'],
  ['(19)?50[- ]?х(?![а-я]| год)|пятидесят[а-я]*(?![а-я]| год)', '1950s', 'era'],
  ['(19)?60[- ]?х(?![а-я]| год)|шестидесят[а-я]*(?![а-я]| год)', '1960s', 'era'],
  ['(19)?70[- ]?х(?![а-я]| год)|семидесят[а-я]*(?![а-я]| год)', '1970s', 'era'],
  ['(19)?80[- ]?х(?![а-я]| год)|восьмидесят[а-я]*(?![а-я]| год)', '1980s', 'era'],
  ['(19)?90[- ]?х(?![а-я]| год)|девяност[а-я]*(?![а-я]| год)', '1990s', 'era'],
]

const COMPILED = TERMS.map(([src, tag, kind, inst]) => {
  // Every pattern starts at a word start; a `$` closing an alternative means "and ends the word".
  const body = src.replace(/\$(?=\||\)|$)/g, '(?![a-zа-я0-9])')
  return { re: new RegExp(`(?<![a-zа-я0-9])(?:${body})`, 'g'), tag, kind, inst: !!inst }
})

const TEMPO: [RegExp, string, number][] = [
  [/(?<![а-я])очень медленн|(?<![a-z])very slow/, 'very slow tempo', 60],
  [/(?<![а-я])(медленн|неспешн|нетороплив|тягуч|вязк|медляк)|(?<![a-z])slow(?![a-z])/, 'slow tempo', 70],
  [/(?<![а-я])(умеренн[а-я]* темп|средн[а-я]* темп)|(?<![a-z])mid[- ]?tempo/, 'mid-tempo', 100],
  [/(?<![а-я])очень быстр|(?<![a-z])very fast/, 'very fast tempo', 170],
  [/(?<![а-я])(быстр|стремительн)|(?<![a-z])(fast|uptempo)(?![a-z])/, 'fast tempo', 140],
]

const INSTRUMENTAL_RE = /(?<![а-я])(инструментал|без (слов|вокала|голоса|пения|текста))|(?<![a-z])(instrumental|no vocals?|without (vocals|singing|lyrics))(?![a-z])/
const VOCAL_RE =
  /(?<![а-я])(вокал|голос|по[её]т|поют|пени[ея]|певиц|певец|исполнител|рэп|реп(?![а-я])|хор(?![а-я]|ош)|куплет|припев|текст(?!ур)|песн[яюи] (о|об|про)|слова(?![а-я])|речитатив)|(?<![a-z])(vocals?|singer|sings?|singing|rap|rapper|choir|lyrics|verses?|chorus)(?![a-z])/
const BPM_RE = /(\d{2,3})\s*(bpm|уд(ар[а-я]*)?\.?\s*(\/|в)\s*мин|бпм|bpm)/i

export interface StyleHints {
  /** English tags, in the order the user mentioned them (tempo last). */
  tags: string[]
  /** The same tags grouped for the prose caption. */
  parts: { genres: string[]; instruments: string[]; moods: string[]; vocals: string[]; eras: string[]; refs: string[]; tempo: string | null }
  /** Whether a genre was named (otherwise the LM is free to pick one). */
  hasGenre: boolean
  /** Explicit or tempo-word BPM. */
  bpm: number | null
  /** true = "instrumental" was asked for (or implied by an instrumental-only genre with no vocal cues); false = vocals were mentioned. */
  instrumental: boolean | null
  /** The text is mostly non-Latin — the DiT would not understand it verbatim. */
  needsTranslation: boolean
}

export const hasCyrillic = (s: string): boolean => /[а-яё]/i.test(s)

/** Latin words that make a fragment typed by the user a genre ("dark jazz") rather than a reference ("Bohren und der Club of Gore"). */
const LATIN_GENRE = /\b(jazz|rock|pop|metal|punk|hip[- ]?hop|rap|trap|drill|phonk|lo-?fi|ambient|drone|techno|house|trance|dubstep|dnb|drum and bass|wave|core|folk|soul|funk|blues|disco|r&b|edm|electro\w*|synth\w*|chill\w*|trip[- ]?hop|downtempo|classical|orchestral|cinematic|score|soundtrack|swing|bossa|latin|reggae|ska|dub|gospel|country|indie|grunge|shoegaze|emo|noir|garage|breakbeat|jungle|idm|chiptune|8-?bit|k-?pop|j-?pop|ballad|acoustic)\b/i

function containsWord(long: string, short: string): boolean {
  return long !== short && new RegExp(`(^|[\\s-])${short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s-])`, 'i').test(long)
}

export function extractStyle(input: string): StyleHints {
  const text = input.toLowerCase().replace(/ё/g, 'е')
  type Hit = { at: number; tag: string; kind: Kind | 'ref'; inst: boolean }
  const found: Hit[] = []
  for (const t of COMPILED) {
    t.re.lastIndex = 0
    const m = t.re.exec(text)
    if (m) found.push({ at: m.index, tag: t.tag, kind: t.kind, inst: t.inst })
  }
  // Latin fragments the user typed themselves ("dark jazz", "Bohren und der Club of Gore") are kept verbatim.
  if (hasCyrillic(input)) {
    const latin = /[A-Za-z][A-Za-z0-9'&.+-]*(?:[ \t]+[A-Za-z0-9][A-Za-z0-9'&.+-]*)*/g
    for (let m; (m = latin.exec(input)); ) {
      const frag = m[0].replace(/[.\s-]+$/, '')
      if (frag.length < 2 || /^(bpm|a|the|feat\.?|ft\.?)$/i.test(frag)) continue
      found.push({ at: m.index, tag: frag, kind: LATIN_GENRE.test(frag) ? 'genre' : 'ref', inst: false })
    }
  }
  found.sort((a, b) => a.at - b.at)

  const unique: Hit[] = []
  for (const f of found) if (!unique.some((u) => u.tag.toLowerCase() === f.tag.toLowerCase())) unique.push(f)
  // "trumpet" is redundant next to "muted trumpet", "jazz" next to "dark jazz" — but the mood "dark" stays next to the genre "dark jazz".
  const kept = unique.filter((f) => !unique.some((o) => o.kind === f.kind && containsWord(o.tag.toLowerCase(), f.tag.toLowerCase())))

  let bpm: number | null = null
  const explicit = BPM_RE.exec(text)
  if (explicit && Number(explicit[1]) >= 30 && Number(explicit[1]) <= 300) bpm = Number(explicit[1])
  let tempo: string | null = null
  for (const [re, tag, value] of TEMPO) {
    if (re.test(text)) {
      tempo = tag
      bpm ??= value
      break
    }
  }

  const vocalCue = VOCAL_RE.test(text) || found.some((f) => f.kind === 'vocal')
  let instrumental: boolean | null = null
  if (INSTRUMENTAL_RE.test(text)) instrumental = true
  else if (vocalCue) instrumental = false
  else if (found.some((f) => f.inst)) instrumental = true

  const of = (kind: Hit['kind']) => kept.filter((f) => f.kind === kind).map((f) => f.tag)
  const letters = input.replace(/[^A-Za-zА-Яа-яЁё]/g, '')
  const cyr = letters.replace(/[A-Za-z]/g, '').length
  return {
    tags: [...kept.map((f) => f.tag), ...(tempo ? [tempo] : [])],
    parts: { genres: of('genre'), instruments: of('inst'), moods: of('mood'), vocals: of('vocal'), eras: of('era'), refs: of('ref'), tempo },
    hasGenre: kept.some((f) => f.kind === 'genre'),
    bpm,
    instrumental,
    needsTranslation: letters.length > 0 && cyr / letters.length > 0.3,
  }
}

const list = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * The caption to send to the DiT for a user's description: their own English wording, or — for a
 * non-English description — a short English description built from the recognised style, in the
 * prose form ACE-Step's captions are trained on. Empty when nothing usable was recognised.
 */
export function styleCaption(input: string, hints = extractStyle(input)): string {
  const text = input.trim()
  if (!text) return ''
  if (!hints.needsTranslation) return text
  const { genres, instruments, moods, vocals, eras, refs, tempo } = hints.parts
  if (!genres.length && !instruments.length && !moods.length && !vocals.length && !refs.length) return ''
  const inst = hints.instrumental === true
  // Short and focused: a long list of blended genres and moods pulls the DiT towards its generic lo-fi/pop defaults.
  const lead = [tempo?.replace(/ tempo$/, ''), ...moods.slice(0, 3)].filter(Boolean).join(', ')
  const noun = inst ? 'piece' : 'song'
  let head = `${lead ? `A ${lead} ` : 'A '}${inst ? 'instrumental ' : ''}${genres[0] ? `${genres[0]} ${noun}` : noun}`
  if (genres.length > 1) head += ` blending ${list(genres.slice(1, 3))}`
  if (eras.length) head += `, ${eras.join(' / ')} style`
  if (hints.bpm) head += `, ${hints.bpm} BPM`
  const out = [`${head}.`]
  if (instruments.length) out.push(`Featuring ${list(instruments.slice(0, 6))}.`)
  if (vocals.length && !inst) out.push(`${cap(list(vocals))}.`)
  if (moods.length > 3) out.push(`${cap(list(moods.slice(3, 5)))} mood.`)
  if (refs.length) out.push(`Inspired by ${list(refs.slice(0, 2))}.`)
  return out.join(' ').replace(/\ba ([aeiou])/i, (m, v) => `${m[0]}n ${v}`)
}
