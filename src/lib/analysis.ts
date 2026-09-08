// CorpusMind Voice — academic corpus analysis engine (server-side).
// Computes the full "Linguistic Analysis" report from stored utterances/tokens:
//   overview · frequency + DP dispersion · keyword analysis (log-likelihood G²,
//   LogRatio effect size) · n-grams · collocations (MI / t / logDice) ·
//   lexical diversity (TTR / MATTR / MTLD / lexical density) · readability
//   (Flesch / Flesch–Kincaid / LIX) · disfluency rates · prosody aggregates ·
//   ASR confidence distribution.
// Everything is computed locally — no network, no uploads.
import type { AnalysisReport, AnalysisToken } from "@/lib/types";

// ---------------------------------------------------------------- stopwords
// Function-word lists used for (a) the content/function split and (b) the
// built-in keyness reference when the corpus has no sibling sessions.
// Values are approximate general-language per-mille frequencies.
const EN_STOP = new Set(
  ("a about above after again against all am an and any are aren as at be because been before being below between both but by can cannot could couldn did didn do does doesn doing don down during each few for from further had hadn has hasn have haven having he her here hers herself him himself his how i if in into is isn it its itself just ll me might more most must my myself no nor not now of off on once only or other our ours ourselves out over own re same shan she should shouldn so some such than that the their theirs them themselves then there these they this those through to too under until up ve very was wasn we were weren what when where which while who whom why will with won would wouldn you your yours yourself yourselves shall may might must upon also however thus therefore oh um uh erm hmm yeah yes okay right like mean know think said says say got get going wanna gonna kind sort thing things lot").split(
    " "
  )
);

const EN_PRIOR_PER_K: Record<string, number> = {
  the: 58, of: 28, and: 27, to: 24, a: 19, in: 9.6, that: 8.8, is: 9.1, was: 8.7,
  it: 8.6, for: 8.4, on: 6.3, with: 6.2, as: 5.9, he: 5.1, his: 4.3, be: 4.2,
  this: 3.8, have: 3.8, are: 3.7, not: 3.6, but: 3.5, had: 3.2, at: 3.6,
  which: 3.1, you: 3.4, i: 3.4, they: 2.9, her: 2.7, she: 2.6, from: 2.6,
  or: 2.5, an: 2.2, we: 2.4, were: 2.1, been: 1.9, there: 1.9, one: 1.9,
  do: 1.8, has: 1.7, no: 1.6, if: 1.6, so: 1.5, what: 1.5, my: 1.4, can: 1.4,
  said: 1.3, would: 1.3, will: 1.2, when: 1.2, me: 1.2, them: 1.1, their: 1.2,
  who: 1.1, all: 1.1, him: 1.0, about: 1.0, its: 1.0, up: 0.9, out: 0.9,
  more: 0.9, some: 0.8, into: 0.8, than: 0.8, other: 0.8, new: 0.8, only: 0.7,
  over: 0.7, also: 0.7, two: 0.7, may: 0.7, our: 0.6, these: 0.6, such: 0.6,
  because: 0.5, us: 0.5, very: 0.4, just: 0.5, get: 0.5, am: 0.4, did: 0.5,
  does: 0.4, now: 0.4, then: 0.5, here: 0.4, your: 0.6, off: 0.3, own: 0.3,
  way: 0.4, well: 0.4, go: 0.4, know: 0.6, see: 0.5, think: 0.4, like: 0.5,
  yeah: 0.6, okay: 0.4, um: 0.5, uh: 0.5, right: 0.4, mean: 0.3, really: 0.4,
  say: 0.5, actually: 0.3, something: 0.3, things: 0.3, kind: 0.3, sort: 0.2,
  going: 0.4, gonna: 0.2, want: 0.3, make: 0.3, much: 0.3, many: 0.3, even: 0.3,
  still: 0.3, back: 0.3, where: 0.4, why: 0.3, how: 0.5, those: 0.3, most: 0.3,
  between: 0.3, through: 0.3, each: 0.2, any: 0.3, same: 0.2, while: 0.3,
};

const AR_STOP = new Set(
  "في من على إلى عن مع هذا هذه هذان ذلك تلك التي الذي الذين اللاتي أن إن لم لن ما لا قد كان كانت يكون تكون هو هي هم هن نحن أنا أنت يا كل بعض أي حيث كما أو ثم لكن حتى إذا حين بين عند لدى منذ سوف قد أه يعني آه إيه أه طب طيب بص خلاص تمام أوكي".split(
    " "
  )
);

const AR_PRIOR_PER_K: Record<string, number> = {
  في: 22, من: 30, على: 11, إلى: 8, عن: 6.5, مع: 5, هذا: 6, هذه: 4, ذلك: 2.5,
  التي: 8, الذي: 7.5, الذين: 2, أن: 8.5, إن: 6, ما: 8, لا: 8, لم: 3, لن: 2,
  قد: 4, كان: 10, كانت: 5.5, يكون: 2.5, هي: 4, هو: 8, هم: 3, كل: 4, بعض: 3,
  عند: 3, كما: 3, أو: 5, ثم: 3, لكن: 2.5, حتى: 3, إذا: 3, حين: 2, بين: 4,
  فيه: 2, منها: 2, إليه: 1.5, عليها: 1.5, بها: 1.5, منه: 1.5,
  يعني: 4, آه: 1.5, إيه: 2, طيب: 1.5, خلاص: 1, تمام: 1.5, عشان: 1.5, بس: 2.5,
  زي: 2, كده: 2, دلوقتي: 1.5, إحنا: 2, أنا: 3, إنت: 2, رأيك: 1, المشكلة: 1,
};

const STOPS: Record<"en" | "ar", Set<string>> = { en: EN_STOP, ar: AR_STOP };
const PRIORS: Record<"en" | "ar", Record<string, number>> = { en: EN_PRIOR_PER_K, ar: AR_PRIOR_PER_K };

// ---------------------------------------------------------------- helpers
const AR_DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g;

export function normalize(word: string): string {
  return word
    .toLowerCase()
    .replace(AR_DIACRITICS, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[.,!?;:،؛"'“”«»()\[\]{}…–—]/g, "")
    .trim();
}

function isArabicText(s: string): boolean {
  return /[\u0600-\u06FF]/.test(s);
}

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalize)
    .filter((w) => w.length > 0);
}

function countFreq(words: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

/** MATTR — Moving-Average Type-Token Ratio (Covington & McFall 2010). */
function mattr(words: string[], window = 50): number {
  const n = words.length;
  if (n === 0) return 0;
  if (n <= window) return new Set(words).size / n;
  let sum = 0;
  let windows = 0;
  const counts = new Map<string, number>();
  // initial window
  for (let i = 0; i < window; i++) counts.set(words[i], (counts.get(words[i]) ?? 0) + 1);
  sum += counts.size / window; windows++;
  for (let i = window; i < n; i++) {
    const out = words[i - window];
    const c = counts.get(out)!;
    if (c <= 1) counts.delete(out); else counts.set(out, c - 1);
    counts.set(words[i], (counts.get(words[i]) ?? 0) + 1);
    sum += counts.size / window; windows++;
  }
  return sum / windows;
}

/** MTLD — Measure of Textual Lexical Diversity (McCarthy & Jarvis 2010). */
function mtld(words: string[], threshold = 0.72): number {
  const factor = (arr: string[]): number => {
    let factors = 0, types = 0;
    const counts = new Map<string, number>();
    let start = 0;
    for (let i = 0; i < arr.length; i++) {
      const w = arr[i];
      if (!counts.has(w)) types++;
      counts.set(w, (counts.get(w) ?? 0) + 1);
      const ttr = types / (i - start + 1);
      if (ttr <= threshold) {
        factors++;
        counts.clear(); types = 0; start = i + 1;
      }
    }
    // partial factor for the remainder
    if (counts.size > 0) {
      const ttr = types / (arr.length - start);
      factors += ttr < 1 ? (1 - ttr) / (1 - threshold) : 0;
    }
    return factors;
  };
  const f = factor(words);
  const b = factor([...words].reverse());
  if (f + b === 0) return 0;
  return words.length / ((f + b) / 2);
}

/** DP — Deviation of Proportions (Gries 2008); 0 = perfectly even. */
function dispersionDP(perPart: number[], total: number): number {
  const n = perPart.length;
  if (n === 0 || total === 0) return 1;
  let s = 0;
  for (const p of perPart) s += Math.abs(p / total - 1 / n);
  return s / 2;
}

function countSyllables(word: string): number {
  const w = word.replace(/[^a-z]/g, "");
  if (!w) return 1;
  const groups = w.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 1;
  if (w.endsWith("e") && n > 1 && !/[aeiouy]{2}e$/.test(w)) n--;
  return Math.max(1, n);
}

/** Dunning 1993 log-likelihood keyness (G²). */
function logLikelihood(o1: number, n1: number, o2: number, n2: number): number {
  const p1 = o1 / n1, p2 = o2 / n2, p = (o1 + o2) / (n1 + n2);
  const ll =
    2 * (o1 * Math.log(p1 / p || 1e-12) + o2 * Math.log(p2 / p || 1e-12));
  return (p1 >= p2 ? ll : -ll); // signed: positive = over-use vs reference
}

/** Hardie 2014 LogRatio effect size (using LL-tested expected freq). */
function logRatio(o1: number, n1: number, o2: number, n2: number): number {
  const p1 = o1 / n1, p2 = o2 / n2;
  const eps = 1e-6;
  return Math.log2((p1 + eps) / (p2 + eps));
}

// ---------------------------------------------------------------- engine
interface EngineUtterance {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  speaker: string;
  disfluencies: unknown;
  prosody: unknown;
  tokens: { text: string; confidence: number; startMs?: number; endMs?: number }[];
}

export interface SiblingCounts {
  tokens: number;
  freq: Map<string, number>;
}

export function computeAnalysis(
  meta: { fileName: string; language: string; durationSec: number },
  utterances: EngineUtterance[],
  siblings: SiblingCounts | null
): AnalysisReport {
  const lang: "en" | "ar" = meta.language === "en" ? "en" : "ar";
  const all: AnalysisToken[] = [];
  const perUttWords: string[][] = [];

  for (const u of utterances) {
    const ws: string[] = [];
    for (const t of u.tokens) {
      const n = normalize(t.text);
      if (!n) continue;
      ws.push(n);
      const startMs = typeof t.startMs === "number" ? t.startMs : u.startMs;
      const endMs = typeof t.endMs === "number" ? t.endMs : u.endMs;
      all.push({
        text: n, utt: u.index, ms: Math.round(startMs),
        startMs: Math.round(startMs), endMs: Math.round(endMs),
        raw: t.text, conf: t.confidence,
      });
    }
    perUttWords.push(ws);
  }
  const flat = perUttWords.flat();
  const N = flat.length;
  const freq = countFreq(flat);
  const durationSec = Math.max(meta.durationSec, 0.1);

  // ---------- overview ----------
  const types = freq.size;
  const hapax = [...freq.values()].filter((v) => v === 1).length;
  const meanWordLen = N ? flat.reduce((a, w) => a + w.length, 0) / N : 0;

  // ---------- frequency + dispersion ----------
  const nParts = Math.max(1, utterances.length);
  const perWordParts = new Map<string, number[]>();
  for (let i = 0; i < nParts; i++) {
    const local = countFreq(perUttWords[i] ?? []);
    for (const [w, c] of local) {
      const arr = perWordParts.get(w) ?? new Array(nParts).fill(0);
      arr[i] = c;
      perWordParts.set(w, arr);
    }
  }
  const freqItems = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2000)
    .map(([word, count]) => ({
      word,
      count,
      perK: +((count / Math.max(N, 1)) * 1000).toFixed(2),
      dp: +dispersionDP(perWordParts.get(word) ?? [], count).toFixed(3),
      stop: STOPS[lang].has(word),
    }));

  // ---------- keywords (G² + LogRatio) ----------
  let keyRefSource: "siblings" | "builtin" | null = null;
  let keywords: AnalysisReport["keywords"] = null;
  const refCounts = siblings && siblings.tokens >= 200 ? siblings.freq : null;
  if (refCounts) keyRefSource = "siblings";
  else if (N >= 100) keyRefSource = "builtin";

  if (keyRefSource) {
    const items = freqItems
      .filter((f) => f.count >= 2 && !f.stop) // content candidates
      .slice(0, 300)
      .map((f) => {
        let refCount: number;
        if (refCounts) refCount = refCounts.get(f.word) ?? 0;
        else {
          const prior = PRIORS[lang][f.word] ?? 0.5; // per-mille prior
          refCount = (prior / 1000) * (siblings?.tokens || 100_000);
        }
        const refTotal = refCounts ? siblings!.tokens : (siblings?.tokens || 100_000);
        const g2 = logLikelihood(f.count, N, refCount, refTotal);
        const lr = logRatio(f.count, N, refCount, refTotal);
        return {
          word: f.word,
          count: f.count,
          refPerK: +((refCount / Math.max(refTotal, 1)) * 1000).toFixed(2),
          g2: +g2.toFixed(2),
          logRatio: +lr.toFixed(2),
        };
      })
      .filter((x) => x.g2 > 0)
      .sort((a, b) => b.g2 - a.g2)
      .slice(0, 100);
    keywords = { source: keyRefSource, items };
  }

  // ---------- n-grams & collocations ----------
  const ngramCounts = (k: number): { gram: string; count: number }[] => {
    const m = new Map<string, number>();
    for (const ws of perUttWords) {
      for (let i = 0; i + k <= ws.length; i++) {
        const g = ws.slice(i, i + k).join(" ");
        m.set(g, (m.get(g) ?? 0) + 1);
      }
    }
    return [...m.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([gram, count]) => ({ gram, count }));
  };

  const bigrams: { gram: string; count: number; mi: number; tscore: number; logdice: number }[] = [];
  const bg = new Map<string, number>();
  const uni = freq;
  for (const ws of perUttWords)
    for (let i = 0; i + 1 < ws.length; i++) {
      const g = `${ws[i]} ${ws[i + 1]}`;
      bg.set(g, (bg.get(g) ?? 0) + 1);
    }
  for (const [g, c] of bg) {
    if (c < 2) continue;
    const [a, b] = g.split(" ");
    const fa = uni.get(a) ?? 1, fb = uni.get(b) ?? 1;
    const mi = Math.log2((c * N) / (fa * fb));
    const expected = (fa * fb) / Math.max(N, 1);
    const t = (c - expected) / Math.sqrt(c);
    const logdice = (2 * c) / (fa + fb);
    bigrams.push({
      gram: g, count: c,
      mi: +mi.toFixed(2), tscore: +t.toFixed(2), logdice: +logdice.toFixed(3),
    });
  }
  bigrams.sort((x, y) => y.logdice - x.logdice || y.count - x.count);

  // ---------- readability ----------
  const nUtt = Math.max(1, utterances.length);
  const asl = N / nUtt; // average sentence length (utterance ≈ sentence)
  const longWords = flat.filter((w) => w.length > 6).length;
  const lix = N ? asl + (100 * longWords) / N : 0;
  let flesch: number | null = null, fkGrade: number | null = null;
  if (lang === "en" && N > 0) {
    const syl = flat.reduce((a, w) => a + countSyllables(w), 0);
    const asw = syl / N;
    flesch = +(206.835 - 1.015 * asl - 84.6 * asw).toFixed(1);
    fkGrade = +(0.39 * asl + 11.8 * asw - 15.59).toFixed(1);
  }

  // ---------- lexical ----------
  const contentCount = flat.filter((w) => !STOPS[lang].has(w)).length;
  const lexicalDensity = N ? contentCount / N : 0;

  // ---------- disfluency ----------
  let disflTotal = 0;
  const byType = { fillers: 0, repeats: 0, falseStarts: 0, interruptions: 0, lengthenings: 0 };
  let pauseCount = 0, pauseSum = 0;
  for (const u of utterances) {
    const d = (u.disfluencies ?? null) as Record<string, unknown> | null;
    if (d) {
      const arr = (k: string) => (Array.isArray(d[k]) ? (d[k] as unknown[]).length : 0);
      byType.fillers += arr("fillers");
      byType.repeats += arr("repeats");
      byType.falseStarts += arr("falseStarts");
      byType.interruptions += arr("interruptions");
      byType.lengthenings += arr("lengthenings");
      const pauses = Array.isArray(d.pauses) ? (d.pauses as number[]) : [];
      pauseCount += pauses.length;
      pauseSum += pauses.reduce((a: number, b) => a + b, 0);
    }
  }
  disflTotal = byType.fillers + byType.repeats + byType.falseStarts + byType.interruptions + byType.lengthenings;
  const perK = (v: number) => +((v / Math.max(N, 1)) * 1000).toFixed(2);

  // ---------- prosody ----------
  let f0a = 0, f0n = 0, f0min = Infinity, f0max = -Infinity;
  let inten = 0, jit = 0, shim = 0, hnr = 0, pn = 0;
  for (const u of utterances) {
    const p = (u.prosody ?? null) as Record<string, number | null> | null;
    if (!p) continue;
    if (typeof p.f0MeanHz === "number") { f0a += p.f0MeanHz; f0n++; }
    if (typeof p.f0MinHz === "number") f0min = Math.min(f0min, p.f0MinHz);
    if (typeof p.f0MaxHz === "number") f0max = Math.max(f0max, p.f0MaxHz);
    if (typeof p.intensityMeanDb === "number") inten += p.intensityMeanDb;
    if (typeof p.jitterPct === "number") jit += p.jitterPct;
    if (typeof p.shimmerPct === "number") shim += p.shimmerPct;
    if (typeof p.hnrDb === "number") hnr += p.hnrDb;
    pn++;
  }
  const prosody = pn
    ? {
        utterancesMeasured: pn,
        f0MeanHz: +(f0a / f0n).toFixed(1),
        f0MinHz: Number.isFinite(f0min) ? +f0min.toFixed(1) : null,
        f0MaxHz: Number.isFinite(f0max) ? +f0max.toFixed(1) : null,
        intensityDb: +(inten / pn).toFixed(1),
        jitterPct: +(jit / pn).toFixed(2),
        shimmerPct: +(shim / pn).toFixed(2),
        hnrDb: +(hnr / pn).toFixed(1),
      }
    : null;

  // ---------- confidence ----------
  let cHigh = 0, cMid = 0, cLow = 0, cSum = 0;
  for (const t of all) {
    if (t.conf >= 0.85) cHigh++;
    else if (t.conf >= 0.6) cMid++;
    else cLow++;
    cSum += t.conf;
  }

  return {
    meta: {
      fileName: meta.fileName,
      language: meta.language,
      durationSec: +durationSec.toFixed(1),
    },
    tokens: all,
    overview: {
      tokens: N,
      types,
      utterances: utterances.length,
      wpm: +((N / durationSec) * 60).toFixed(1),
      meanSentenceLen: +asl.toFixed(2),
      meanWordLen: +meanWordLen.toFixed(2),
      hapaxCount: hapax,
      hapaxPct: N ? +((hapax / types) * 100).toFixed(1) : 0,
    },
    frequency: { items: freqItems },
    keywords,
    ngrams: { bigrams: ngramCounts(2), trigrams: ngramCounts(3), fourgrams: ngramCounts(4) },
    collocations: bigrams.slice(0, 25),
    lexical: {
      ttr: N ? +(types / N).toFixed(3) : 0,
      mattr: +mattr(flat).toFixed(3),
      mtld: +mtld(flat).toFixed(1),
      lexicalDensity: +lexicalDensity.toFixed(3),
      contentWords: contentCount,
      functionWords: N - contentCount,
    },
    readability: {
      flesch, fkGrade,
      lix: +lix.toFixed(1),
      longWordPct: N ? +((longWords / N) * 100).toFixed(1) : 0,
      meanSentenceLen: +asl.toFixed(2),
    },
    disfluency: {
      total: disflTotal,
      perK: perK(disflTotal),
      byType: {
        fillers: byType.fillers, fillersPerK: perK(byType.fillers),
        repeats: byType.repeats, repeatsPerK: perK(byType.repeats),
        falseStarts: byType.falseStarts, falseStartsPerK: perK(byType.falseStarts),
        interruptions: byType.interruptions, interruptionsPerK: perK(byType.interruptions),
        lengthenings: byType.lengthenings, lengtheningsPerK: perK(byType.lengthenings),
      },
      pauses: pauseCount,
      pausesPerK: perK(pauseCount),
      pauseMeanMs: pauseCount ? Math.round(pauseSum / pauseCount) : 0,
    },
    prosody,
    confidence: {
      high: cHigh, mid: cMid, low: cLow,
      mean: all.length ? +(cSum / all.length).toFixed(3) : 0,
    },
  };
}
