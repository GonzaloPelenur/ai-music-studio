# ai-music-studio

A Grexal agent that turns natural-language prompts into finished AI music.
Powered by Mureka for audio generation, Moonshot AI Kimi K2.5 (via the
Vercel AI Gateway) for tool orchestration, and Convex for a global
FIFO queue that gates concurrent Mureka requests.

## How this was built

This agent (v1) was generated one-shot by Claude Code Opus 4.7 using the
following prompt — kept here as an example of what a single brief can
produce on Grexal:

> Your task is to fully design, create, and deploy a song generator agent to grexal.
>
> I am already logged in to the grexal CLI, read the full docs to understand how it works: https://docs.grexal.ai/docs
>
> Use Mureka API. Read the pricing at https://platform.mureka.ai/pricing and docs at https://platform.mureka.ai/docs/ .
>
> For the llm, set up moonshotai/kimi-k2.5 with the vercel ai sdk and the vercel ai gateway api key. Pricing for this model is $0.50/M input tokens and $2.80/M output tokens, so it's reasonably priced and still good at using tools.
>
> The agent needs to be an expert at Mureka. It should have tools for using Mureka and know which tools to use depending on the request.
>
> Some mureka models generate two songs at once as default, make sure to research the docs and make it so as default we generate only 1 song.
>
> Users can pass lyrics to the agent to produce a song based on the lyrics, or ask the agent to generate the lyrics and the song based on a prompt and output the lyrics and the song, or generate only lyrics. There are many things you could do with the Mureka API so be creative and give the agent options.
>
> One thing worth considering. Some of the API endpoints for Mureka have strict concurrency limits, look into this well. I am currently on the trial plan so I only get 1 Concurrent request. Suppose that two people are trying to use the agent at the same time, handle this gracefully. Use convex to keep track of which user requested first and complete their requests in order. Set up a new convex project for this. Use Convex as the persistent FIFO job queue and global Mureka concurrency gate.
>
> Make an attractive description for the agent in grexal so that it get's selected more often. For pricing, make sure to factor in the costs of using Mureka. For the ai cost of Kimi, you could choose to charge per tokens but since it's probably a small cost we could get away with adding a fix additional cost. Also make sure to check the Grexal discounts from my earnings and price the agent accordingly so that I make profit even after paying for the API usage.
>
> I created a .env file with MUREKA_API_KEY and VERCEL_AI_GATEWAY_KEY . Use those keys to test that the agent works locally. Then when you push the agent to grexal, use those keys to set the env vars it needs, and do a test run to make sure it works. Debug it until it works.
>
> Also, I will keep this as an open source repo so be sure not to expose anything about me or any sensitive keys.

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
