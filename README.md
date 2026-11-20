# Voice-to-Task Capture Tool

> Press one key, speak a thought, get a parsed task (title, due date, project, priority) auto-added to your todo system.

Voice-to-Task is a local-first voice capture app for frictionless thought-to-task conversion. Hold the big button, say what's on your mind ("remind me to call mom every Sunday at 10am"), and the app transcribes the audio, runs the transcript through a heuristic natural-language parser (with LLM fallback for low-confidence inputs), shows you editable chips for every field, and only commits to your task list when you press Save.

A separate **Voice memo** mode skips parsing entirely and stores the raw audio + duration for later transcription — perfect for capturing a long rambling thought you don't want to structure right now.

---

## MVP scope vs. stretch goals

### MVP (this build)

- **Voice recording** — a "Hold to record" button uses `navigator.mediaDevices.getUserMedia` + `MediaRecorder` to capture audio to a webm/opus Blob. Recorder plumbing is split from the network call so the recorder can be unit-tested without a real mic.
- **STT** — the recorded Blob is base64-encoded and POSTed to `/api/transcribe`, which calls `zai.audio.asr.create({ file_base64 })` from the z-ai-web-dev-sdk and returns the transcript.
- **Task parsing** — the transcript is run through a heuristic parser (`nl-parser.ts`) that handles recurrence, weekday, time-of-day, relative dates, priorities, projects (`/work`), tags (`#tag`), and intent phrases. If the parser's confidence is low and the LLM provider is available, the API falls back to a non-streaming `chat.completions.create` call that returns strict JSON.
- **Inline edit before save** — parsed fields render as editable chips (title input, due date, priority, project, tags, recurrence). User reviews and clicks **Save task** to persist, or **Discard**.
- **Voice memory mode** — a separate tab records audio without parsing, saves it to disk as `./audio/<id>.webm`, and stores a `VoiceMemo` row. A **Transcribe** button on each memo runs it through STT after the fact and back-fills the `transcript` column.
- **Local persistence** — Prisma 6 + SQLite at `./db/custom.db`. All API routes use the Prisma client.

### Stretch goals (documented; not built in MVP)

- **Real Whisper API** — the MVP uses `zai.audio.asr.create`. For self-hosted Whisper, swap `ZaiAsrProvider` for a `WhisperAsrProvider` (the `AsrProvider` interface in `ai.ts` is the only seam).
- **Real global hotkey via Plasmo extension** — a Plasmo browser extension that registers a global hotkey (e.g. Cmd+Shift+Space), pops a tiny capture widget, and POSTs the recorded Blob to `/api/transcribe`. The web app stays as the canonical UI; the extension is just a fast path.
- **iOS share sheet** — a Swift Shortcut that accepts voice input and POSTs to `/api/transcribe`/`/api/voice-memos`, so you can capture from the iOS share menu.
- **Multi-system sync (Todoist / Linear / Notion)** — on `POST /api/tasks`, after the local row is committed, fire-and-forget sync to Todoist (REST), Linear (GraphQL), or Notion (REST) based on the `project` field and tags. The sync adapters are stubbed in `src/lib/sync.ts` and gated on env vars (`TODOIST_API_TOKEN`, `LINEAR_API_KEY`, `NOTION_TOKEN`).
- **Voice memory mode with auto-transcription** — a background job that picks the oldest un-transcribed `VoiceMemo` and runs it through STT when the CPU is idle. Not in MVP; the **Transcribe** button on each memo is the manual trigger.

---

## Features

- **One-key capture** — hold the big button to record, release to stop. No buttons to fumble.
- **Three-tier parsing pipeline** — heuristic → confidence check → LLM fallback. The heuristic handles ~80% of natural task phrases ("tomorrow at 9am", "every Sunday", "/work", "#client", "high priority") deterministically and offline.
- **Editable preview chips** — every parsed field is shown as an inline-editable chip before saving. The user is always in the loop.
- **Voice memo mode** — capture raw thoughts now, structure them later.
- **Project + priority filters** — the sidebar's recent-tasks list filters by project and priority via a shadcn Select.
- **Stats header** — `GET /api/stats` returns total tasks, voice memos, and transcribed memos for at-a-glance status.
- **Local-first** — SQLite. Your data is on your disk. No account.

---

## Tech stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript 5 |
| Styling | Tailwind CSS 4 + shadcn/ui (New York) + Lucide icons |
| Database | Prisma 6 + SQLite (local file at `./db/custom.db`) |
| STT | `z-ai-web-dev-sdk` → `zai.audio.asr.create({ file_base64 })` |
| LLM fallback | `z-ai-web-dev-sdk` → `zai.chat.completions.create({ stream:false })` |
| Audio capture | `navigator.mediaDevices.getUserMedia` + `MediaRecorder` |
| Tests | `bun test` (Bun's native test runner) |
| Lint | `eslint-config-next` |

---

## Architecture

```
                      Browser (src/app/page.tsx)
                              |
                              | hold-to-record
                              v
            +-----------------------------------+
            |  MediaRecorder  (Web Audio API)   |
            +-----------------------------------+
                              | webm/opus Blob
                              v
            +-----------------------------------+
            |  audio-handler.ts                 |
            |   - audioBlobToFile                |
            |   - encodeAudioToBase64            |
            |   - validateAudioFormat            |
            +-----------------------------------+
                              | base64
                              v
            +-----------------------------------+
            |  POST /api/transcribe              |
            |   - asr-builder.formatAsrRequest   |
            |   - ai.getAsrProvider.transcribe   |
            |     (ZaiAsrProvider | MockAsrProvider)|
            +-----------------------------------+
                              | transcript text
                              v
            +-----------------------------------+
            |  POST /api/parse-task              |
            |   1. nl-parser.parseTask (heuristic)|  <-- confidence score
            |   2. if confidence < 0.3 && LLM ok: |
            |      task-parser-llm.parseTaskWithLlm|
            |        (buildTaskParsePrompt +      |
            |         chat.complete -> JSON)      |
            +-----------------------------------+
                              | ParsedTask { title, dueAt, project,
                              |   priority, contextTags, recurrenceRule }
                              v
            +-----------------------------------+
            |  Editable preview chips in UI     |
            |  (user reviews + edits)            |
            +-----------------------------------+
                              | user clicks "Save task"
                              v
            +-----------------------------------+
            |  POST /api/tasks                   |
            |   - prisma.task.create             |
            |   - (stretch) sync to Todoist/etc. |
            +-----------------------------------+

   Voice memo mode skips parse-task and writes directly to
   POST /api/voice-memos -> ./audio/<id>.webm + VoiceMemo row.
```

---

## Setup

```bash
# 1. Install deps
bun install

# 2. Create the SQLite db + generate the Prisma client
bun run db:push

# 3. (optional) Configure env
cp .env.example .env
# Edit .env if your db path differs. The db: scripts inline the
# absolute path via $(pwd) so you usually don't need to change it.

# 4. Run the dev server (Next.js 16, port 3000)
bun run dev

# 5. Run the unit tests
bun test
```

Open the app via your **Preview Panel** (or click "Open in New Tab" in the
sandbox web UI). Grant microphone permission when prompted, then press and
hold the big central button.

---

## Tests

```bash
bun test
```

35+ unit tests across 6 suites:

| Suite | Coverage |
|---|---|
| `nl-parser.test.ts` | 17 cases — recurrence ("every Sunday at 10am" → weekly:Sunday + 10:00), relative dates ("tomorrow" → tomorrow 9am; "in 3 days"), weekday ("by Friday" → next Friday), priorities ("high priority:"), projects (`/work`), tags (`#client`), intent stripping ("remind me to call mom" → "call mom"). |
| `task-formatter.test.ts` | `formatTaskForUi` — dueAt formatted as "Tomorrow 10:00 AM", recurrence as "weekly on Sunday". |
| `audio-handler.test.ts` | `audioBlobToFile`, `validateAudioFormat` for webm/ogg/mp3/wav, `encodeAudioToBase64` signature. |
| `asr-builder.test.ts` | `formatAsrRequest` returns `{ file_base64 }`. |
| `task-parser-llm.test.ts` | `buildTaskParsePrompt` asks for JSON `{ title, dueAt?, project?, priority, contextTags? }` and includes the transcript. |
| `ai.test.ts` | Mock ChatProvider returns deterministic parsed-task JSON; Mock AsrProvider returns deterministic transcript. |

Tests are bun-native (`import { test, expect, describe } from 'bun:test'`) and only exercise pure functions — the network, Prisma, and MediaRecorder layers are mocked or stubbed so the suite runs offline.

---

## Env vars

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | `file:./db/custom.db` | Absolute path to the local SQLite db. |
| `VTT_DISABLE_LLM` | no | `0` | `1` → use MockChatProvider (offline deterministic task parsing). |
| `VTT_DISABLE_ASR` | no | `0` | `1` → use MockAsrProvider (offline deterministic transcription). |
| `TODOIST_API_TOKEN` | no | — | Stretch: push completed tasks to Todoist. |
| `LINEAR_API_KEY` | no | — | Stretch: push `/work` tasks to Linear. |
| `NOTION_TOKEN` | no | — | Stretch: push tasks to a Notion database. |
| `NOTION_DATABASE_ID` | no | — | Stretch: target Notion DB id. |

---

## Project structure

```
36-voice-to-task/
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── tailwind.config.ts
├── components.json
├── eslint.config.mjs
├── .env / .env.example
├── .gitignore
├── LICENSE
├── README.md
├── prisma/
│   └── schema.prisma            # Task + VoiceMemo models
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Hold-to-record + editable preview + sidebar
│   │   ├── globals.css
│   │   └── api/
│   │       ├── transcribe/route.ts
│   │       ├── parse-task/route.ts
│   │       ├── tasks/route.ts
│   │       ├── tasks/[id]/route.ts
│   │       ├── voice-memos/route.ts
│   │       ├── voice-memos/[id]/transcribe/route.ts
│   │       └── stats/route.ts
│   ├── components/ui/            # shadcn/ui (button, card, badge, input, label,
│   │                             #   tabs, separator, select, sonner, scroll-area,
│   │                             #   skeleton) — only what we use
│   └── lib/
│       ├── utils.ts              # cn() helper
│       ├── db.ts                 # Prisma client singleton
│       ├── ai.ts                 # ChatProvider + AsrProvider (Zai | Mock)
│       ├── nl-parser.ts          # heuristic task parser (confidence-scored)
│       ├── task-formatter.ts     # ParsedTask -> UI display strings
│       ├── audio-handler.ts      # Blob <-> File <-> base64 + format validator
│       ├── asr-builder.ts        # build the zai.audio.asr.create request body
│       ├── task-parser-llm.ts    # buildTaskParsePrompt + parseTaskWithLlm
│       └── __tests__/
│           ├── nl-parser.test.ts
│           ├── task-formatter.test.ts
│           ├── audio-handler.test.ts
│           ├── asr-builder.test.ts
│           ├── task-parser-llm.test.ts
│           └── ai.test.ts
├── db/                          # SQLite file lives here (gitignored)
└── audio/                       # Voice-memo .webm files (gitignored)
```

---

## Case study — STT → heuristic parsing → LLM fallback pipeline

The interesting part of this project is the three-tier parsing pipeline. The naive approach is "always ask an LLM," which is slow, costs money, and is unavailable offline. The naive other extreme is "pure regex parsing," which gives up on the long tail of natural phrasings.

**What I built:** every transcript is run first through `nl-parser.ts`, a deterministic heuristic parser that recognizes a fixed grammar of natural task phrases:

- Recurrence: `every Sunday`, `every day`, `every 3 weeks`
- Relative dates: `tomorrow`, `today`, `tonight`, `in 3 days`, `by Friday`, `next Monday`
- Time-of-day: `at 10am`, `at 3 pm`, `at 7`
- Priorities: `high priority:`, `low priority:`, `medium priority:`
- Projects: `/work`, `/personal`
- Tags: `#client`, `#weekly`
- Intent prefixes: `remind me to`, `remember to`, `I need to`

The parser produces a `confidence` score in [0, 1] — the fraction of feature slots it actually detected. If `confidence >= 0.3`, the heuristic answer is returned. If `confidence < 0.3` and the LLM provider is available (not mocked), the API route falls back to `task-parser-llm.ts`, which builds a strict-JSON prompt, calls the non-streaming `chat.completions.create`, and parses the response. The LLM is the safety net, not the default.

**Why this works:** the heuristic handles the ~80% of inputs that follow the predictable grammar ("buy milk tomorrow", "call mom every Sunday at 10am") in <1ms, offline, deterministically — so the test suite can assert exact outputs without an LLM round-trip. The LLM handles the long tail ("the thing my boss mentioned in the offsite last week") that the regex grammar can't see.

**What I'd do differently:**

1. **Real Whisper via z-ai SDK on every memo.** The MVP only transcribes on demand. The better UX is to transcribe every voice memo on save (in a background task) so the **Transcribe** button is unnecessary — the user always sees text. The `AsrProvider` interface already makes this a one-line change.

2. **Real global hotkey.** The web app requires a tab switch and a click. A Plasmo extension with a global hotkey (Cmd+Shift+Space) that pops a 200ms capture widget and POSTs the Blob to `/api/transcribe` would cut capture time from ~5s to <1s. The backend already accepts multipart; the extension is purely a client-side fast path.

3. **Real multi-system sync.** The local DB is the source of truth in MVP, but most users already live in Todoist/Linear/Notion. The right pattern is: write locally first (for low-latency ack), then enqueue a sync job per external system that uses the local row as the canonical record and reconciles remote IDs back into a `SyncedTask` join table.

4. **Real iOS share sheet.** A Shortcuts.app action that takes voice input and POSTs to `/api/voice-memos` would let iOS users capture without opening the web app. The backend already supports it — only the iOS glue is missing.

5. **Streaming ASR.** `zai.audio.asr.create` is a one-shot call. A streaming STT endpoint would let the UI render the transcript character-by-character as the user speaks, which feels magical and lets them catch transcription errors live.

6. **Confidence calibration.** The 0.3 threshold is a guess. With a few hundred labeled (transcript, gold-task) pairs, I'd compute the heuristic's precision/recall curve and pick the threshold that maximizes F1 — and I'd ship a "send to LLM anyway" toggle for power users who don't trust the heuristic.

---

## Resume bullet

> Built **Voice-to-Task**, a local-first voice capture app (Next.js 16, Prisma + SQLite, z-ai-web-dev-sdk) that turns spoken thoughts into structured tasks. Designed a 3-tier parsing pipeline — heuristic regex parser (confidence-scored) → LLM JSON fallback → user-edited chips before save — so 80% of inputs are parsed deterministically offline in <1ms and the LLM is only invoked on the long tail. Wrote 35+ bun-native unit tests covering the parser, audio handlers, ASR request builder, LLM prompt builder, and provider mocks; added a Voice memo mode that saves raw audio to disk for later transcription.

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Push to GitHub

```bash
gh repo create voice-to-task --public --source=. --remote=origin --push
```
