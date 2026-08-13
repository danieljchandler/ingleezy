#!/usr/bin/env python3
"""Propose MSA -> Yemeni substitution rules from the Lisan lexicon.

Reads docs/yemeni/lexicon-full.json and emits candidate pairs where an attested
Yemeni surface form is linked by the annotators to a *different* MSA lemma.
Output: docs/yemeni/rule-candidates.json.

This is a candidate generator, not a seeder. Precision is deliberately not 100%
-- the pairs land in `dialect_rules` as status='draft' and an admin approves
them through the Dialect Rulebook UI, which is where the judgement belongs.

Three things it will not do, each learned from a wrong answer the data gave:

1. Closed-class only. Content words are where Arabic broken plurals live
   (الفوانيس <- فانوس), and the plural changes the internal vowel pattern, so
   no stem comparison separates them from real substitutions. It is also where
   the corpus's civil-war vocabulary sits. Dialect substitution rules are about
   function words anyway -- see the seeded rulebook: وين not أين, ليش not لماذا.

2. Never proposes a form that is itself standard MSA. The annotators link
   تلك -> ذلك and هن -> هم, which is feminine agreement, not dialect. The MSA
   closed-class stoplist is parsed out of derive-yemeni-artifacts.py rather
   than copied, so the two cannot drift.

3. Flags Egyptian code-switching instead of proposing it. Yemeni Twitter
   borrows heavily from Egyptian media: فين outranks وين in this corpus, and
   دي/ده/ليه are common. Seeding those as Yemeni would contradict
   DIALECT_EXTRA.Yemeni, which exists to catch exactly that drift.

Usage:  python3 scripts/derive-yemeni-rule-candidates.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEXICON = ROOT / 'docs/yemeni/lexicon-full.json'
DERIVE = ROOT / 'scripts/derive-yemeni-artifacts.py'
DETECTOR = ROOT / 'supabase/functions/_shared/msaLeakDetector.ts'
OUT = ROOT / 'docs/yemeni/rule-candidates.json'

MIN_COUNT = 20

TASHKEEL = re.compile(r'[ً-ٰٟـ]')


def norm(s: str) -> str:
    """Mirrors normalizeArabic in msaLeakDetector.ts, plus lemma sense noise.

    MSA lemmas carry disambiguation markers the detector never sees -- في2,
    كيف 1, ل-, فهم- -- so digits, spaces and hyphens come out too. Without
    that, في and في2 compare unequal and every preposition looks dialectal.
    """
    s = TASHKEEL.sub('', s or '')
    s = re.sub(r'[آأإٱ]', 'ا', s)
    s = s.replace('ى', 'ي').replace('ة', 'ه')
    return re.sub(r'[\d\s\-]', '', s).strip()


def parse_list(text: str, pattern: str) -> set:
    m = re.search(pattern, text, re.S)
    return {norm(x) for x in re.findall(r"'([^']+)'", m.group(1))} if m else set()


def load_reference():
    """Single source of truth: read the lists, never copy them."""
    derive_src = DERIVE.read_text(encoding='utf-8')
    m = re.search(r'MSA_FUNCTION = set\(map\(norm, """(.*?)"""', derive_src, re.S)
    if not m:
        sys.exit('could not parse MSA_FUNCTION out of derive-yemeni-artifacts.py')
    msa_function = {norm(w) for w in m.group(1).split()}
    # the script also folds و/ف onto every entry; mirror that
    msa_function |= {norm('و' + w) for w in list(msa_function)}
    msa_function |= {norm('ف' + w) for w in list(msa_function)}

    det = DETECTOR.read_text(encoding='utf-8')
    universal = parse_list(det, r'UNIVERSAL_MSA_LEAKS\s*=\s*\[(.*?)\]')
    wrong_dialect = parse_list(det, r'Yemeni:\s*\[(.*?)\]')
    egyptian_ok = parse_list(det, r'Egyptian: new Set\(\[(.*?)\]\.map')
    yemeni_ok = parse_list(det, r'Yemeni: new Set\(\[(.*?)\]\.map')
    return msa_function, universal, wrong_dialect, egyptian_ok, yemeni_ok


# Closed-class POS tags in the Lisan/SAMA tagset. Anything open-class is
# excluded for the reasons in the module docstring.
CLOSED_CLASS = {
    'أداة استفهام', 'ظرف استفهام', 'ضمير استفهام', 'أداة نفي', 'ضمير',
    'ضمير اشارة', 'اسم موصول', 'ظرف', 'عطف', 'أداة ربط', 'حرف جر',
    'أداة شرط', 'أداة نهي', 'اسم كم',
}

PROCLITICS = ['ال', 'و', 'ف', 'ب', 'ك', 'ل', 'س', 'وال', 'فال', 'بال', 'كال',
              'لل', 'وب', 'ول', 'في', 'من', 'ما', 'ي', 'ت', 'ن', 'ا', 'وي',
              'وت', 'فت', 'لي', 'لت']
ENCLITICS = ['ه', 'ها', 'هم', 'هن', 'ك', 'كم', 'كن', 'ي', 'نا', 'ني', 'وا',
             'ون', 'ين', 'ات', 'ان', 'هما', 'كما', 'ش', 'ت', 'و', 'ا']


def derivable(a: str, b: str) -> bool:
    """True when a is b plus ordinary affixation -- morphology, not substitution."""
    if a == b:
        return True
    for p in [''] + PROCLITICS:
        for s in [''] + ENCLITICS:
            if a == p + b + s:
                return True
    return False


def main() -> int:
    msa_function, universal, wrong_dialect, egyptian_ok, yemeni_ok = load_reference()

    raw = json.loads(LEXICON.read_text(encoding='utf-8'))
    rows = raw if isinstance(raw, list) else next(
        v for v in raw.values()
        if isinstance(v, list) and v and isinstance(v[0], dict)
    )

    cand: dict = {}
    for r in rows:
        yem, msa = norm(r.get('token', '')), norm(r.get('msa_lemma') or '')
        pos = (r.get('pos') or '').strip()
        if not yem or not msa or yem == msa or pos not in CLOSED_CLASS:
            continue
        if derivable(yem, msa) or derivable(msa, yem):
            continue
        if yem in msa_function or yem in universal:
            continue                      # the "Yemeni" side is plain MSA
        if yem in wrong_dialect:
            continue                      # already flagged as wrong for Yemeni
        key = (yem, msa)
        if key not in cand or r['count'] > cand[key]['count']:
            cand[key] = {
                'yemeni': yem,
                'msa': msa,
                'count': r['count'],
                'pos': pos,
                'gloss': (r.get('gloss') or '').strip(),
                'cross_dialect': yem in egyptian_ok and yem not in yemeni_ok,
            }

    # Collapse و/ف/ب/ل + X onto X when both were proposed for the same lemma:
    # وليش and ليش are one rule, not two.
    proposed = set(cand)
    for yem, msa in list(cand):
        if len(yem) > 2 and yem[0] in 'وفبل' and (yem[1:], msa) in proposed:
            cand.pop((yem, msa), None)

    out = sorted(cand.values(), key=lambda c: -c['count'])
    seedable = [c for c in out if not c['cross_dialect'] and c['count'] >= MIN_COUNT]
    flagged = [c for c in out if c['cross_dialect'] and c['count'] >= MIN_COUNT]

    OUT.write_text(json.dumps({
        'source': 'derived from docs/yemeni/lexicon-full.json',
        'description': (
            'Candidate MSA->Yemeni substitutions for dialect_rules. Closed-class '
            'only; the Yemeni side is never itself MSA; Egyptian code-switches '
            'are flagged rather than proposed. Review before approving -- these '
            'seed as status=draft.'
        ),
        'min_count': MIN_COUNT,
        'seedable': seedable,
        'flagged_cross_dialect': flagged,
    }, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    print(f'seedable: {len(seedable)}   flagged cross-dialect: {len(flagged)}')
    for c in seedable:
        print(f"  {c['count']:>6}  {c['yemeni']:<10} <- {c['msa']:<10} {c['pos']}")
    if flagged:
        print('\nflagged as Egyptian code-switch (excluded):')
        for c in flagged:
            print(f"  {c['count']:>6}  {c['yemeni']:<10} <- {c['msa']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
