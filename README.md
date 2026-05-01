# ai-music-studio

A Grexal agent that turns natural-language prompts into finished AI music.
Powered by Mureka for audio generation, Moonshot AI Kimi K2.5 (via the
Vercel AI Gateway) for tool orchestration, and Convex for a global
FIFO queue that gates concurrent Mureka requests.

## What it does

Given a prompt, the agent figures out what you want and runs the right
Mureka tools:

- **Just lyrics.** Returns a generated title + lyrics.
- **Song from a vibe.** Generates lyrics, then turns them into a full song
  (vocals + music). Returns MP3 + FLAC + WAV links.
- **Song from lyrics you wrote.** Skips lyric generation, sends your text
  straight to the song model.
- **Pure instrumental.** Background music with no vocals.

## Why the queue?

Mureka's trial plan allows only one concurrent song-generation request.
The agent enqueues a ticket in Convex and waits its turn before touching
the Mureka API, so two simultaneous Grexal runs serialise instead of
failing.

## Running locally

```sh
cp .env.example .env
# Fill in MUREKA_API_KEY and AI_GATEWAY_API_KEY

npm install
npx convex dev          # one-time: creates a Convex project, writes CONVEX_URL into .env.local
# merge CONVEX_URL into .env, then:

npx grexal dev --once --input '{"prompt":"upbeat 80s pop song about Tuesdays"}'
```

`npx convex dev` should be left running in another terminal during local
testing so the queue functions stay live-deployed.

## Deploying to Grexal

```sh
npx grexal push
npx grexal env set MUREKA_API_KEY <your-key>
npx grexal env set AI_GATEWAY_API_KEY <your-key>
npx grexal env set CONVEX_URL <https://...convex.cloud>
npx grexal agent price add run_completed 0.40
npx grexal agent set-visibility public
npx grexal publish
```

## Repo layout

```
.
├── index.ts                     Agent entrypoint
├── grexal.json                  Manifest
├── src/
│   ├── env.ts                   Env-var loader
│   ├── mureka.ts                Mureka REST client
│   ├── queue-client.ts          Convex client wrapper
│   ├── runWithMurekaSlot.ts     FIFO queue gate
│   ├── tools.ts                 AI SDK tool defs
│   └── prompts.ts               System prompt
└── convex/
    ├── schema.ts                queueTickets table
    └── queue.ts                 enqueue / tryAcquire / heartbeat / release
```
