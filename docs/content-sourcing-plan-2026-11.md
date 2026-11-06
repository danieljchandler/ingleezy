# Finding content for Ingleezy — a sourcing plan (2026-11)

**Status:** proposal, written 2026-11-06 from this repo, the Maktaba repo,
Hikaya's `docs/content-library-architecture.md` and `docs/x-content-pipeline.md`,
and the Ingleezy and Maktaba project hubs. Nothing here is built. §1 names
two things the code does today that the plan has to route around; §8 is the
list of what is Daniel's to decide. Companion notes: `RETARGET.md` (the media
pipeline section), `docs/content-library-bridge.md` (this app's half of the
Maktaba bridge), `docs/backend-bootstrap.md` §0 and §5 (the secrets the
pipeline needs), and Hikaya's `docs/content-strategy-2026-10.md`, whose §0
rights tiers and §3 "well" this plan borrows.

The ask: a repeatable way to find real spoken English that an Arabic speaker
wants to watch, and get it into the app in a shape the app can teach from.

---

## 0. Where content enters, as built

The unit of content is a **clip**: a `discover_videos` row with English
transcript lines, each carrying a dialect-Arabic scaffold, a Fusha line and a
literal word-order gloss (`process-english-video`). Everything else the
learner sees is either generated from the learner model or arrives on its
own.

| Surface | How it gets in | What a human supplies | State today |
| --- | --- | --- | --- |
| English clips (`discover_videos`) | `/admin/videos/new` → `process-english-video` (Deepgram nova-3, then one Brain call per 25 lines for the scaffold) | a YouTube / TikTok / Instagram URL, the scaffold dialect, a difficulty; CEFR is a button on the form (`rate-video-cefr`) | works one URL at a time; no bulk import |
| The same, from the library | Maktaba `dispatch-item` → `ingest-from-library` → `process-english-video`; creator name and handle ride along | a `ready` item in Maktaba | built on both sides, not wired: see §1.3 |
| Trending Shorts | `discover-trending-videos` (YouTube Data API, US and GB, twelve speech-first queries, no-speech and gaming exclusions) → `/admin/trending` | approve or reject each candidate | works, but see §1.1 |
| Bridged Hikaya clips | `sync-hakiya-videos` snapshot, published rows only | nothing | automatic; immersion content, not what this plan sources |
| Reading library | `/admin/reading-library` | an English text with author, source URL, source name and a licence (public domain, CC0, CC-BY, CC-BY-SA) | works; a separate, smaller stream (§3d) |
| Memes | `/admin/videos/new` with "meme" ticked → `analyze-meme` | a URL | works; occasional |
| Stories, listen episodes, daily story, daily challenge, Souq news, set phrases | generated from the learner model | nothing | no sourcing needed |
| X posts | the learner pastes one on `/learn-from-x` | nothing | learner-driven; a Maktaba `post` item has no path into this app, because the bridge only makes videos |

The route this plan uses for clips is the library one, because it is the
only route that records **who made the clip**, holds an item for months
without losing it (thumbnail and audio mirrored at capture), dedupes on the
platform id rather than the URL, and lets Claude propose while Daniel
publishes:

```
research → Maktaba inbox → triaged → ready → dispatch → ingest-from-library
        → process-english-video → /admin/videos (check, rate CEFR, publish)
```

`/admin/videos/new` stays the path for a one-off clip somebody sends today.

---

## 1. Three things to know before sourcing at volume

### 1.1 Approving a trending Short runs the Arabic pipeline

`src/pages/admin/TrendingVideos.tsx`, the approve mutation: it inserts the
`discover_videos` row (dialect `Gulf`, difficulty `Intermediate`) and then
invokes **`process-approved-video`**, the six-engine Arabic ASR ladder.
`AdminVideoForm` was switched to `process-english-video` in the retarget;
this page was not. `process-approved-video` has no English hand-off, so an
approved English Short is transcribed as Arabic. Until the invoke is
swapped, approve a crawler candidate by copying its URL into
`/admin/videos/new`. The fix is one line plus a test in
`src/pages/admin/` and is the first item in §8.

### 1.2 The scaffold dialect decides who can see a clip

For an English clip, `discover_videos.dialect` names the dialect the Arabic
scaffold was written in (the row comment in `TrendingVideos.tsx` and the
`DIALECTS` map in `ingest-from-library` both say so). Three readers treat it
as the clip's dialect:

- `discover-feed` restricts its pool to `dialect in (learner's module, MSA)`
  (`supabase/functions/discover-feed/index.ts`, the candidate-pool query).
- `/discover` defaults its filter to the learner's dialect; "All" is a
  choice the learner has to make (`src/pages/Discover.tsx`).
- `useTodaysVideo` reads the learner's dialect first and falls back to any
  dialect only when that comes back empty.

So a clip scaffolded in Gulf is served to Gulf learners and is absent from an
Egyptian or Yemeni learner's feed. `RETARGET.md` says native English content
is unfiltered by dialect; the feed function says otherwise. Two ways out:

1. **Stop filtering native rows by dialect** (`source <> 'hakiya'`), show the
   stored scaffold plus the Fusha line every Arab reads, and regenerate a
   learner's own dialect on tap (`translate-phrase en_to_ar` already does
   this per phrase). One row per clip. Recommended.
2. Dispatch every clip once per audience dialect: three rows, three
   transcriptions, three scaffolds. Triples the pipeline cost and splits
   likes, watch history and reviews across copies.

Until that is decided, scaffold in **Gulf** (the first-named audience in
`RETARGET.md`) and record the choice in the item's note.

### 1.3 The pipe is built but not open

From the hubs (checked 2026-10-31, 2026-11-06):

- Ingleezy's Supabase project (`rawkvbehwsigjbjdqrhj`) is paused and cannot
  be resumed while `maktaba` and `hikaya` hold the two free-plan slots.
- 13 migrations are unpushed, including `20260919120000_library_bridge`
  (the `library_item_id` / `creator_*` columns).
- Signup needs an invite code inserted by hand (`docs/backend-bootstrap.md`
  §7); the first admin's id becomes `LIBRARY_BRIDGE_USER_ID`.
- Secrets: `LIBRARY_BRIDGE_SECRET` here and `INGLEEZY_SUPABASE_URL` +
  `INGLEEZY_BRIDGE_SECRET` on Maktaba; `DEEPGRAM_API_KEY` for transcription;
  the AI routing decision of `docs/backend-bootstrap.md` §0 for the scaffold
  Brain call; `YOUTUBE_API_KEY` for the crawler.
- `dispatch-item` does not check that an item is `ready` (Maktaba hub, open).

None of this blocks the research. Maktaba is designed for the gap between
"saved it" and "processed it" being months: items wait in the inbox with
their audio mirrored. The first dispatch to Ingleezy is the end of week 0,
not the start of week 1.

---

## 2. The selection brief

### Who it is for

An Arabic speaker (Gulf first, then Egyptian and Yemeni), young, video-first,
in an app whose chrome is Arabic. They meet English at work, at university,
travelling, on the phone to customer service, and online. They do not want
teacher English; the product's whole claim is that the English is real.

### What a good clip is

- **Speech is the product.** One or two people talking to camera or to each
  other. No music over the voice, no text-only clips, no "no talking".
- **20 to 180 seconds.** Shorts and TikToks by default; a two-minute podcast
  cut is the long end. Longer than that is a Listen episode, not a clip.
- **Clean audio.** Street noise is fine if the voice is on a mic; a phone
  held across a room is not.
- **Natural register.** Storytelling, opinion, banter, explaining something
  they know, answering a question. Scripted reads, lectures and lessons are
  out.
- **The accent is a model at A2, a reality at B2.** General US and UK first,
  which is what the crawler already does. Non-native English (Arab creators,
  footballers) is its own shelf, tagged so it is never the only model a
  beginner hears.
- **Visible context for the lower bands.** At A2 the thing being talked
  about should be on screen: a kitchen, a room, a shop, a phone.
- **The clip plays in the app.** Public, embeddable, not region-locked.
  Instagram saves fine but enrichment usually fails, so check it plays
  before marking it ready.

### Five shelves

Shares are a target mix for the first hundred, not a rule.

| Shelf | Band | Formats | Share | Maktaba tags (see §5 for the new ones) |
| --- | --- | --- | --- | --- |
| **Street and everyday** | A2–B1 | street interviews, what's in my bag, room and fridge tours, cooking along | 25% | `setting:street`, `setting:kitchen`, `setting:family`, `vibe:slow-speech` |
| **Situations** | A2–B1 | ordering, the airport, the doctor, a call to customer service, a job interview, small talk in an office | 25% | `setting:shop`, `setting:phone-call`, `setting:airport`, `setting:office`, `function:ordering`, `function:small-talk`, `function:job-interview` |
| **Storytime and opinion** | B1–B2 | storytime, podcast cuts, day-in-my-life with narration, "explained in 60 seconds" | 25% | `function:storytelling`, `function:giving-opinion` |
| **Arab creators in English** | B1–B2 | Khaleeji and Egyptian creators who vlog, interview or joke in English; code-switched clips go to both apps as `mixed` | 15% | `vibe:arab-accent`, `project:ingleezy` |
| **Football and the region** | B1 | post-match interviews, fan vox pops, expat life in Dubai and Riyadh in English | 10% | `topic:football`, `topic:travel`, `topic:work` |

The Situations shelf is the one the app is built around: `setting` and
`function` are the facets the architecture calls "what it *teaches*", and
they map to the set-phrase occasions and the real-world prompts of the
curriculum.

### What to reject, and why

- No speech, music, ASMR, "satisfying", gaming: the crawler's own exclusion
  lists, applied by hand to everything else.
- ESL teacher-talk. It is the English equivalent of the devotional false
  positive in `docs/x-content-pipeline.md`: a person speaking clearly to
  camera, in a register nobody uses. Mark the creator `VERIFY — probably
  reject` rather than dropping them, so the judgement is kept.
- News reads and lectures: scripted, and the Listen episodes cover the
  register better.
- Heavy profanity, and content centred on alcohol or dating. The audience is
  largely Gulf, Egyptian and Yemeni families, often with a parent paying.
  Propose `vibe:clean-language` as a tag and make it the default filter for
  the A2–B1 shelves rather than a ban on the library (§8.6).
- Politics, religion beyond everyday formulas, and anything about a named
  private person: the rule `docs/marketing/prompts/find-stitch-phrases.md`
  already applies in Hikaya.

### Rights

Hikaya's content strategy §0 holds here unchanged. In the app a clip plays
through the platform's own embedded player, so the creator keeps the view;
audio is mirrored only so the pipeline can transcribe it. Every item gets a
creator record, which is where permission state lives when a clip is reused
beyond the app (a Stitch, a post). Never re-upload a creator's clip as our
own.

---

## 3. Where to look

Two findings from the X loop shape all of this: **the platform's own graph
beats web search** (web search returned listicles with no handles; mention
mining from one working seed returned nine reachable accounts), and **a
guessed handle is wrong more often than right** (over half of a plausible
list returned nothing). So: seed, mine, verify by fetch, and expect a low hit
rate.

### 3a. YouTube

- **Channel first, not search.** `search.list` costs 100 quota units a call;
  a channel's uploads playlist costs 1 per 50 videos. Hikaya's
  `scripts/harvest-channels.ts` never calls search for that reason. Pick
  channels, enumerate their uploads, keep what is 20–180 s. The channel list
  belongs in Maktaba as approved creators (§5), not in a table of feeds this
  app does not have.
- **The crawler** keeps doing what it does: twelve queries, two per fetch,
  12 kept per region. Add a query only after measuring the keep-rate of the
  existing twelve at `/admin/trending`; the three mislabels pinned in its
  topic lists are the warning.
- **Speech signal for free:** `videoCaption=closedCaption` on a search, and
  a caption track on a channel video, both mean someone is talking.

### 3b. TikTok

- Hashtags in the shelf's own words: `#storytime`, `#streetinterview`,
  `#dayinmylife`, `#britishslang`, `#americanslang`, `#smalltalk`,
  `#jobinterviewtips`, `#customerservice`; for the Arab shelf `#dubailife`,
  `#dubaiexpat`, `#saudiexpat`, `#riyadhlife`, `#arabsbelike`,
  `#arabsinlondon`.
- **TikTok Creative Center**, trending videos filtered to GB and US, and to
  AE and SA with English in the title, weekly. Its seven-day view bypasses
  our own algorithm.
- **Mention mining from a seed.** Who an approved creator duets, stitches,
  replies to and tags is in the same language community by construction.
  Two seeds a week.
- Expect enrichment to stall: on 2026-10-31 TikTok served a challenge page
  after the first fetch. A row is valid with nothing but a URL; triage from
  the app's own player when oEmbed is blank.

### 3c. Starting points for the first pass

Unverified. Every one is fetched before it goes in a bundle, and the note
quotes a line of what the account actually says.

| Starting point | Shelf | What to check |
| --- | --- | --- |
| Easy English (Easy Languages) | Street | UK street interviews, subtitled, slow. The nearest thing to the "simplified video" the curriculum asks for at A2. |
| Chicken Shop Date, BBC Three clips | Street / Storytime | UK, short, deadpan; language level of individual clips. |
| Jubilee | Storytime | US, debate and interview formats; B2, long, cut to Shorts. |
| Diary of a CEO Shorts | Storytime | UK host, guest accents vary; B2. |
| Khalid Al Ameri | Arab creators | Emirati, family and social videos in English; clean, widely shared in the Gulf. |
| ABtalks (Anas Bukhash) | Arab creators | Dubai, long interviews in English with Arab guests; cut to clips. Code-switching → `mixed`. |
| The Mo Show | Arab creators | Saudi podcast in English; guests from the region. |
| Supercar Blondie | Region | Dubai-based, English, car content with a lot of talking. |
| Mo Amer, Ramy Youssef stand-up clips | Arab creators | Arab-American; language and topic check per clip. |
| Premier League and club channels, Saudi Pro League English content | Football | Post-match interviews are short, clean and formulaic in a useful way; players' English is non-native, so tag it. |

### 3d. Reading, separately

The reading library wants whole texts with a licence. Sources that answer
that: Project Gutenberg (public domain), Wikisource, Simple English Wikipedia
(CC-BY-SA), and the graded readers and short stories published under CC by
ELT publishers. Ten texts across A2–B1 is a month's worth; it does not need
the clip loop.

### 3e. Demand: what learners ask for

The other half of the well. None of it is built into the app; it is a
30-minute read a month until there are learners.

- r/EnglishLearning and r/ENGLISH, top of the month: the questions are the
  topics.
- r/dubai, r/saudiarabia, r/Egypt searched for `english`, `interview`,
  `accent`, `IELTS`: the situations in the learner's own words. IELTS is the
  motive for a large share of Arab learners even when the app never mentions
  it; the speaking-test topics (hometown, work, a journey, a hobby) are a
  ready shelf.
- Comments under Arabic-language "تعلم الانجليزي" YouTube channels: what
  nobody answered.
- **The app's own data, once there are learners:** which interference
  buckets `learner_errors` fills, what the tutor is asked, which words are
  saved most. A bucket nobody can clear is a shelf to source next.

### 3f. The calendar

Football season (August to May, and the transfer windows), the academic year
and scholarship season (August and September: university abroad, the visa
interview), Riyadh Season (October to March: going out, tickets, prices),
Dubai Shopping Festival (December and January), Ramadan and the Eids (the
English a colleague says to you, and what to answer).

---

## 4. The loop, as a runbook

Prerequisite: `MAKTABA_URL`, `MAKTABA_ANON_KEY`, `MAKTABA_TOKEN` in the
Maktaba repo's `.env`, and `deno`. `M` below is
`deno run --allow-env --allow-net --allow-read scripts/maktaba.ts`.

1. **Research** with `/maktaba-research` and the prompt in appendix A.
   Output is a bundle, `bundles/en-<shelf>-<date>.json`, with `language`
   `en` or `mixed`, `dialect` set to the scaffold audience (`gulf` until
   §1.2 is decided), tags from `$M tags`, and a creator handle on every
   item. Every handle fetched; one quoted line per creator as evidence.
2. **Import:** `$M import bundles/<file>.json`. Creators land as
   `candidate`, items in the inbox, tags as `source: claude`. Report what
   was created, what already existed, and which handles could not be
   verified.
3. **Triage** with `/maktaba-triage`: watch it, set `register spoken`, the
   tags (one `setting`, one or two `topic` or `function`, `vibe` for audio
   and pace), a one-line note, a rating, and the creator link; status
   `triaged`. Say when the clip could not be watched.
4. **Daniel marks ready**, approves creators worth keeping, and for TikToks
   runs `$M enrich <id> --audio` so the target skips its own download.
5. **Dispatch** with `/maktaba-dispatch`: `$M dispatch <ids> --to ingleezy`
   in batches of ten, then `$M dispatches --status processing --refresh`.
   An `ar` item sent here is flagged; `mixed` goes to both apps.
6. **In this app**, `/admin/videos`: read the transcript, spot-check the
   dialect scaffold (the MSA-leak scan covers the dialect lines; the Fusha
   line is MSA on purpose), press the CEFR rating, set difficulty, publish.
   Note the creator name and handle on the row; `creator_name` was null on
   Maktaba's one real dispatch because no creator was linked.
7. **Record** what each shelf cost and how long found-to-published took, for
   §7.

Appendix B is one bundle item in full.

---

## 5. What the English column needs from Maktaba

Small, human-run, each a migration applied by `supabase db push`.

- **Tags.** The seeded vocabulary is Arabic-shaped (majlis, bargaining).
  Add: settings `airport`, `office`, `restaurant`, `clinic`, `university`,
  `customer-service`; functions `ordering`, `small-talk`,
  `asking-directions`, `job-interview`, `making-plans`, `giving-opinion`;
  vibes `clean-language`, `subtitled`, `us-accent`, `uk-accent`,
  `arab-accent`; and `project:ingleezy`. The `facet` column is a six-value
  check constraint, so accent and audience live under `vibe` and `project`
  rather than new facets.
- **Grammar tags for `en` items** use this repo's
  `GRAMMAR_CATEGORY_IDS` (`articles`, `prepositions`, `negation`,
  `questions`, `verb-conjugation`, `pronouns`, `possessives`,
  `sentence-structure`), not Hikaya's taxonomy, so a dispatched clip can seed
  the concept the mastery ladder climbs. The two added in the retarget,
  articles and prepositions, are the interference buckets the app exists for.
- **The `ready` guard** on `dispatch-item`, already on the Maktaba hub.
- **Later, once creators are approved:** a harvester over approved creators'
  YouTube uploads, a port of Hikaya's `harvest-channels.ts`, so a creator
  becomes a feed without `search.list` quota. Not before there are twenty
  approved creators to run it over.

---

## 6. Cadence and targets

**Week 0, unblock and decide.** The §8 decisions; free a Supabase slot;
`db push`; first admin and invite code; the secrets of §1.3; deploy
`ingest-from-library`; set the Maktaba pair; one clip from `/admin/videos/new`
end to end, then one from Maktaba. Research starts the same week.

**Weeks 1–2, seed.** Fifteen creators across the five shelves; sixty items
in the inbox; forty triaged; twenty ready; ten dispatched; the first ten
published, read line by line, and costed.

**Weeks 3–6, the first hundred.** A hundred published English clips, at
least fifteen in each of A2, B1 and B2; a third UK; a fifth from Arab
creators; a creator record on every one; and a measured answer to "what
share of the library can each dialect's feed serve" (§1.2).

**Weekly, sixty minutes:** a crawler fetch and its review (through the form
until §1.1 is fixed); the Creative Center scan; mention-mine two seeds;
triage the inbox; dispatch a batch; refresh dispatches and retire failures.

**Monthly:** creator outreach and permission state; a dead-link sweep
(mirrored audio keeps the item usable, the embed does not); the demand
sources of §3e; re-measure §7.

---

## 7. Measuring whether it worked

- **Pipeline:** dispatch success rate; cost per clip (Deepgram plus one
  Brain call per 25 lines; measure on the first ten, then add the row to the
  spend model, which `docs/ai-spend-2026-10.md` in Hikaya requires of every
  model-calling feature); hours from found to published.
- **Library:** counts per shelf, band and accent; share with a creator; the
  per-dialect feed coverage of §1.2.
- **Learner, once there are learners:** completion per clip, words saved per
  clip, which clips the tutor is asked about, and whether the `articles` and
  `prepositions` buckets in `learner_errors` move for learners who watched
  the Situations shelf.

---

## 8. Decisions for Daniel

1. **§1.1:** swap the trending approve invoke to `process-english-video`
   (recommended), or retire `/admin/trending` in favour of the library.
2. **§1.2:** stop filtering native clips by dialect (recommended), or
   dispatch once per audience dialect.
3. **The free-plan slot:** pause or delete one of `maktaba` / `hikaya`, or
   upgrade. The plan needs Ingleezy's project awake.
4. **AI routing for the scaffold call:** `docs/backend-bootstrap.md` §0.
5. **Default scaffold dialect** while 2 is open: Gulf.
6. **Cultural fit:** `vibe:clean-language` as the default filter for the
   A2–B1 shelves (recommended), or as a hard rule on the library.
7. **Non-native English** (Arab creators, footballers) as a tagged shelf
   (recommended), or native only.
8. **The harvester** of §5: after twenty approved creators, or not at all.

---

## Appendix A. The research prompt

Adapted from `docs/x-content-pipeline.md` stage 1 and `maktaba-research`.
Give it to `/maktaba-research` with the shelf filled in.

> Find TikTok and YouTube accounts that post short clips of **real spoken
> English** that an Arabic speaker learning English would want to watch:
> **{shelf: street interviews and everyday life | situations (ordering,
> airport, doctor, customer service, job interviews, small talk) | storytime
> and opinion | Arab creators who speak English | football and life in the
> Gulf in English}**. I want people talking: to camera, to each other, to a
> stranger. **Not** English lessons, not teachers, not news reads, not
> lectures, not music, not gaming, not clips built on profanity, alcohol or
> dating.
>
> Prefer general US and UK accents, except on the Arab-creator shelf, where
> the point is Khaleeji and Egyptian people speaking English. Clips should
> be 20 to 180 seconds with clean audio. For the A2 shelves, the thing being
> talked about should be visible on screen.
>
> Start from the seeds I give you and from who they duet, stitch, reply to
> and tag; use hashtags in the shelf's own words; use web search last and
> only for handles you then verify. **Fetch every profile before you write it
> down.** A handle that 404s or is private is not in the bundle. For each
> account: the handle, a display name, the country, what it actually posts,
> and one quoted line of English from it as evidence. For each clip: why it
> is teachable in one line, the shelf's tags, and the creator's handle.
>
> Return a Maktaba bundle (appendix B shape), 10 to 15 creators and 30 to 60
> clips, `language` `en` (or `mixed` when the clip switches into Arabic),
> `dialect` `gulf`. Say which handles you could not verify instead of
> dropping them.

## Appendix B. One bundle item

```json
{
  "source": "claude:research-2026-11-situations",
  "creators": [
    {
      "displayName": "Easy English", "country": "UK", "dialect": null,
      "genre": "street-interview",
      "notes": "Subtitled street interviews in London; slow, clear, one question per clip. «What's the best thing about living here?» Verified 2026-11-xx.",
      "handles": [{ "platform": "youtube", "handle": "<handle as fetched>", "url": "https://www.youtube.com/@<handle as fetched>" }]
    }
  ],
  "items": [
    {
      "url": "https://www.youtube.com/shorts/<id>",
      "language": "en", "dialect": "gulf",
      "note": "Ordering coffee, three exchanges, barista on mic, cups on screen — A2 Situations",
      "creatorHandle": { "platform": "youtube", "handle": "<handle as fetched>" },
      "tags": ["setting:shop", "function:ordering", "vibe:slow-speech", "vibe:clean-language", "project:ingleezy"]
    }
  ]
}
```

`dialect` on an `en` item is the scaffold audience, which is what
`ingest-from-library` reads it as; `subvariety` stays blank. Tags not yet in
`$M tags` are ignored and reported, which is how §5's migration gets
noticed.
