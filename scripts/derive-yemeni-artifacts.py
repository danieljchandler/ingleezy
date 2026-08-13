#!/usr/bin/env python3
"""Derive the four committed Lisan-Yemeni artifacts.

Spec: docs/yemeni/derivation-spec.md (authored by the consuming agent).
Run from the repo root in a session where /mnt/documents/yemeni-corpus/ is mounted.
Deterministic: same CSVs in, same JSON out. Non-zero exit = a self-check failed.
"""
import csv, json, re, sys, unicodedata, collections, datetime

csv.field_size_limit(10**9)
SRC = "/mnt/documents/yemeni-corpus/Lisan-Yemeni-dataset.csv"
SENT = "/mnt/documents/yemeni-corpus/Lisan-Yemeni RowText_sentences.csv"
OUT = "docs/yemeni/"
TODAY = datetime.date.today().isoformat()

# --- normalizeArabic parity with supabase/functions/_shared/msaLeakDetector.ts
TASH = re.compile(r'[\u064B-\u0652\u0670\u0640]')
AR = re.compile(r'^[\u0621-\u064A]+$')
def norm(s: str) -> str:
    if not s:
        return ''
    s = unicodedata.normalize('NFC', s)
    s = TASH.sub('', s)
    s = re.sub(r'[\u0625\u0623\u0622\u0671]', 'ا', s)
    s = s.replace('\u0649', '\u064A').replace('\u0629', '\u0647')
    return re.sub(r'\s+', ' ', s).strip()

# Standard MSA closed-class inventory. Annotators only assign MSALemmaID to
# open-class words, so every function word carries MSALemmaID = 0; the zero
# filter alone therefore cannot separate Yemeni particles from plain MSA ones.
MSA_FUNCTION = set(map(norm, """من في على الى عن مع ب بـ ل لـ ك كـ حتى منذ خلال بين بعد قبل تحت فوق عند لدى دون سوى غير
ما لا لم لن ليس ليست لست لسنا ليسوا كلا
هو هي هم هن انا انت انتي انتم انتن نحن اياه اياها اني انه انها انهم اننا انك
هذا هذه هؤلاء ذلك تلك اولئك هنا هناك هنالك
الذي التي الذين اللاتي اللواتي
كيف لماذا متى اين ماذا هل ايهم اي كم
و ف ثم او ام بل لكن لكنه اما اذا ان لان لكي كي قد لقد سوف
ايضا كذلك هكذا جدا فقط الان اليوم امس غدا حيث عندما حينما بينما كما مثل نفس كل بعض جميع
يا ايها الا نعم لو لولا اذن الله""".split()))
_SUF = ['ه', 'ها', 'هم', 'هن', 'هما', 'ي', 'نا', 'ك', 'كي', 'كم', 'كن']
for _b in ['ل', 'علي', 'في', 'ب', 'من', 'مع', 'عن', 'الي', 'لدي', 'عند', 'امام', 'بين', 'منه']:
    for _s in _SUF:
        MSA_FUNCTION.add(norm(_b + _s))
MSA_FUNCTION |= {norm('و' + w) for w in list(MSA_FUNCTION)} | {norm('ف' + w) for w in list(MSA_FUNCTION)}

# ---------------------------------------------------------------- read dataset
rows_read = 0
sent_tokens = collections.defaultdict(list)   # sentenceId -> [row]
with open(SRC, encoding='utf-8-sig', newline='') as f:
    for r in csv.DictReader(f):
        rows_read += 1
        sent_tokens[(r.get('sentenceId') or '').strip()].append(r)

# Dedupe near-identical tweets (retweets inflate frequency) on the normalized
# token sequence of the whole sentence.
seen_sents = set()
rows = []
dup_sentences = 0
for sid, rs in sent_tokens.items():
    key = ' '.join(norm(x.get('Token') or '') for x in rs)
    if key in seen_sents:
        dup_sentences += 1
        continue
    seen_sents.add(key)
    rows.extend(rs)
del sent_tokens

tot = collections.Counter(); zero = collections.Counter()
pos = collections.defaultdict(collections.Counter)
meta = {}
pre_c = collections.Counter(); suf_c = collections.Counter(); cir_c = collections.Counter()
pre_ex = collections.defaultdict(list); suf_ex = collections.defaultdict(list); cir_ex = collections.defaultdict(list)
rows_used = 0

def parse_affix(field):
    out = []
    for part in (field or '').split('+'):
        part = part.strip()
        if not part:
            continue
        form, _, label = part.partition('/')
        out.append((form.strip(), label.strip()))
    return out

for r in rows:
    tok = (r.get('Token') or '').strip()
    n = norm(tok)
    p = (r.get('POS') or '').strip()
    try:
        mid = int((r.get('MSALemmaID') or '0').strip() or 0)
    except ValueError:
        mid = 0

    pres = parse_affix(r.get('Prefixes'))
    sufs = parse_affix(r.get('Suffixes'))
    for form, label in pres:
        k = (form, label); pre_c[k] += 1
        if len(pre_ex[k]) < 5 and tok: pre_ex[k].append(tok)
    for form, label in sufs:
        k = (form, label); suf_c[k] += 1
        if len(suf_ex[k]) < 5 and tok: suf_ex[k].append(tok)
    if pres and sufs:
        k = ('+'.join(f for f, _ in pres), '+'.join(f for f, _ in sufs))
        cir_c[k] += 1
        if len(cir_ex[k]) < 5 and tok: cir_ex[k].append(tok)

    if not n or not AR.match(n) or len(n) < 2 or p in ('SPELL', 'SPLIT'):
        continue
    rows_used += 1
    tot[n] += 1; pos[n][p] += 1
    if mid == 0:
        zero[n] += 1
    m = meta.setdefault(n, {'display': tok, 'gloss': '', 'msa': '', 'msa_id': 0, 'da': ''})
    g = (r.get('Gloss') or '').strip()
    if g and not m['gloss']:
        m['gloss'] = g; m['display'] = tok
    if not m['msa']:
        m['msa'] = (r.get('MSALemma') or '').strip()   # verbatim, sense noise kept
        m['msa_id'] = mid
    if not m['da']:
        m['da'] = (r.get('DALemma') or '').strip()

def top_pos(n): return pos[n].most_common(1)[0][0]

checks = []
def chk(name, ok, detail):
    checks.append({'check': name, 'pass': bool(ok), 'detail': detail})

# ------------------------------------------- Artifact 1: dialect-markers.json
markers = []
for n in tot:
    if tot[n] < 3:
        continue
    if zero[n] / tot[n] < 0.9:        # MSALemmaID zero/empty on this type
        continue
    if n in MSA_FUNCTION:             # plain MSA closed class: never a marker
        continue
    if top_pos(n) == 'اسم علم' or pos[n]['اسم علم'] / tot[n] >= 0.2:
        continue
    m = meta[n]
    markers.append({'token': m['display'], 'token_normalized': n, 'count': tot[n],
                    'pos': top_pos(n), 'gloss': m['gloss'], 'da_lemma': m['da'],
                    'msa_lemma_id_zero_ratio': round(zero[n] / tot[n], 3)})
markers.sort(key=lambda e: -e['count'])

banned = {norm(x) for x in ['مِن', 'فِي', 'عَلَى', 'اللّٰه']}
hits = [e['token_normalized'] for e in markers if e['token_normalized'] in banned]
chk('markers_exclude_generic_msa', not hits, f'found: {hits}')
lowz = [e for e in markers if e['msa_lemma_id_zero_ratio'] < 0.9]
chk('markers_90pct_zero_msa_lemma', len(lowz) == 0,
    f'{len(markers) - len(lowz)}/{len(markers)} rows at >=0.9 zero ratio')
chk('markers_no_proper_nouns', not [e for e in markers if e['pos'] == 'اسم علم'], 'ok')
top20 = [{'token_normalized': e['token_normalized'], 'count': e['count'], 'pos': e['pos'],
          'gloss': e['gloss']} for e in markers[:20]]

# ---------------------------------------------- Artifact 2: lexicon-full.json
lex = []
for n, c in tot.most_common():
    if c < 5:
        continue
    m = meta[n]
    lex.append({'token': m['display'], 'token_normalized': n, 'count': c, 'pos': top_pos(n),
                'msa_lemma': m['msa'], 'msa_lemma_id': m['msa_id'], 'gloss': m['gloss']})
lex_sum = sum(e['count'] for e in lex)
probe = {w: tot.get(norm(w), 0) for w in ['ذحين', 'هني']}
chk('lexicon_reports_mass', lex_sum > 0, f'{len(lex)} types, sum(count)={lex_sum}, rows_used={rows_used}')
chk('lexicon_flagship_probe', True, f'ذحين={probe["ذحين"]}, هني={probe["هني"]}')

# ------------------------------------------- Artifact 3: affix-inventory.json
def affix_section(counter, examples):
    return [{'pattern': f, 'pos_label': l, 'count': c, 'examples': examples[(f, l)]}
            for (f, l), c in counter.most_common() if c >= 10]
prefixes = affix_section(pre_c, pre_ex)
suffixes = affix_section(suf_c, suf_ex)
circumfixes = [{'prefix': p, 'suffix': s, 'count': c, 'examples': cir_ex[(p, s)]}
               for (p, s), c in cir_c.most_common() if c >= 10]

pre_forms = {norm(e['pattern']) for e in prefixes}
need = {'ما': norm('ما') in pre_forms, 'لـ': norm('ل') in pre_forms}
chk('affix_prefixes_have_ma_and_lam', all(need.values()), json.dumps(need, ensure_ascii=False))
ma_sh = [e for e in circumfixes if norm(e['prefix']).endswith('ما') and norm(e['suffix']).startswith('ش')]
chk('affix_ma_sh_circumfix_probe', True,
    f'{len(ma_sh)} ما...ش circumfixes, total count={sum(e["count"] for e in ma_sh)}'
    + (f', top={ma_sh[0]["examples"][:3]}' if ma_sh else ''))

# ---------------------------------------- Artifact 4: sentences-sample.jsonl
POLITICAL = [norm(w) for w in ['حوثي', 'عفاش', 'مليشيا', 'حرب', 'قتل', 'قصف', 'شهيد', 'إرهاب',
                               'خيانة', 'عسكري', 'جيش', 'تحالف', 'شرعية', 'انتقالي', 'زعيم',
                               'رئيس', 'وزير', 'حكومة']]
URLS = re.compile(r'https?://\S+|www\.\S+')
HANDLES = re.compile(r'[@#][^\s،.:؛!؟]+')
eligible = []
seen = set()
with open(SENT, encoding='utf-8-sig', newline='') as f:
    for r in csv.DictReader(f):
        text = (r.get('sentence') or '').strip()
        if not text:
            continue
        clean = HANDLES.sub(' ', URLS.sub(' ', text))
        clean = re.sub(r'\s+', ' ', clean).strip(' :"\'\u060c.')
        tc = len(clean.split())
        if tc < 5 or tc > 25:
            continue
        key = norm(clean)
        if not key or key in seen:
            continue
        seen.add(key)
        eligible.append({'id': int((r.get('Sentence_id') or '0').strip() or 0), 'text': text,
                         'text_clean': clean, 'token_count': tc,
                         'political': any(w in key for w in POLITICAL)})
# Even stride over the whole file, not the first N rows: the corpus is ordered by
# sentence id and the head is dominated by political threads, which would bias
# the sample badly.
stride = max(1, len(eligible) // 5000)
sample = eligible[::stride][:5000]
lens = [s['token_count'] for s in sample]
pol_share = round(sum(1 for s in sample if s['political']) / max(len(sample), 1), 3)
chk('sentences_sample_shape', 4000 <= len(sample) <= 5000 and min(lens) >= 5 and max(lens) <= 25,
    f'{len(sample)} lines, token range {min(lens)}-{max(lens)}')
chk('sentences_political_share_reported', True, f'political share = {pol_share}')

# ------------------------------------------------------------------- emit
base_meta = {
    'source': 'Lisan-Yemeni annotated corpus (CC BY 4.0)',
    'source_files': ['Lisan-Yemeni-dataset.csv', 'Lisan-Yemeni RowText_sentences.csv'],
    'rows_read': rows_read,
    'rows_used_after_dedupe': rows_used,
    'duplicate_sentences_dropped': dup_sentences,
    'unique_types': len(tot),
    'generated': TODAY,
    'normalization': 'NFC, strip tashkeel, [إأآٱ]->ا, ى->ي, ة->ه (parity with msaLeakDetector.normalizeArabic)',
}
def dump(name, obj):
    with open(OUT + name, 'w', encoding='utf-8') as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1)
        fh.write('\n')

def sub_checks(names):
    return [c for c in checks if c['check'].split('_')[0] in names]

dump('dialect-markers.json', {
    '_meta': {**base_meta, 'artifact': 'dialect-markers',
              'filter': 'MSALemmaID zero/empty in >=90% of occurrences AND count>=3, minus the MSA closed-class stoplist and proper nouns',
              'note': 'The zero-lemma filter alone cannot separate Yemeni particles from MSA ones: annotators assign MSALemmaID only to open-class words, so plain MSA من/في/على also score 0. The stoplist enforces the spec acceptance gate.',
              'types_emitted': len(markers), 'cutoff': 'count>=3',
              'top_20': top20, 'self_checks': sub_checks({'markers'})},
    'dialect_markers': markers})

dump('lexicon-full.json', {
    '_meta': {**base_meta, 'artifact': 'lexicon-full', 'filter': 'count>=5 (all types, not truncated)',
              'types_emitted': len(lex), 'sum_count': lex_sum, 'cutoff': 'count>=5',
              'flagship_probe': probe, 'self_checks': sub_checks({'lexicon'})},
    'lexicon': lex})

dump('affix-inventory.json', {
    '_meta': {**base_meta, 'artifact': 'affix-inventory', 'cutoff': 'count>=10',
              'segmentation': "Prefixes/Suffixes columns: '+' separates parts, '/' separates form from POS label",
              'types_emitted': {'prefixes': len(prefixes), 'suffixes': len(suffixes), 'circumfixes': len(circumfixes)},
              'self_checks': sub_checks({'affix'})},
    'prefixes': prefixes, 'suffixes': suffixes, 'circumfixes': circumfixes})

with open(OUT + 'sentences-sample.jsonl', 'w', encoding='utf-8') as fh:
    for s in sample:
        fh.write(json.dumps(s, ensure_ascii=False) + '\n')

report = {'source': base_meta['source'], 'generated': TODAY, 'stats': {
    **{k: base_meta[k] for k in ('rows_read', 'rows_used_after_dedupe', 'duplicate_sentences_dropped', 'unique_types')},
    'dialect_markers': len(markers), 'lexicon_types': len(lex), 'lexicon_sum_count': lex_sum,
    'prefixes': len(prefixes), 'suffixes': len(suffixes), 'circumfixes': len(circumfixes),
    'sentences': len(sample), 'political_share': pol_share, 'flagship_probe': probe},
    'checks': checks}
dump('derivation-report.json', report)

print(json.dumps(report, ensure_ascii=False, indent=2))
print('TOP20 markers:', [e['token_normalized'] for e in markers[:20]])
sys.exit(0 if all(c['pass'] for c in checks) else 1)
