import type { AgentContext } from "@grexal/sdk";
import { tool } from "ai";
import { z } from "zod";
import {
  generateLyrics,
  generateSong,
  generateInstrumental,
  type AudioChoice,
} from "./mureka.js";
import { runWithMurekaSlot } from "./runWithMurekaSlot.js";

export interface CollectedArtefacts {
  lyrics?: string;
  title?: string;
  songs: SongRecord[];
}

export interface SongRecord {
  kind: "song" | "instrumental";
  mp3_url: string;
  flac_url?: string;
  wav_url?: string;
  duration_seconds: number;
}

function shape(choice: AudioChoice, kind: SongRecord["kind"]): SongRecord {
  return {
    kind,
    mp3_url: choice.url,
    flac_url: choice.flac_url,
    wav_url: choice.wav_url,
    duration_seconds: Math.round(choice.duration / 1000),
  };
}

export function buildTools(ctx: AgentContext) {
  const collected: CollectedArtefacts = { songs: [] };

  const tools = {
    generate_lyrics: tool({
      description:
        "Generate song lyrics from a prompt. Returns a title and full lyrics. Fast (~2s) and inexpensive. Use this BEFORE generate_song when the user wants a vocal track but didn't provide lyrics.",
      inputSchema: z.object({
        prompt: z
          .string()
          .min(3)
          .describe(
            "Concrete description of what the lyrics should be about, in any language. Include theme, mood, and any specific details the user wants.",
          ),
      }),
      execute: async ({ prompt }) => {
        await ctx.log(`✏️  Generating lyrics: "${prompt.slice(0, 60)}…"`);
        await ctx.progress(0.2);
        const r = await generateLyrics(prompt);
        collected.lyrics = r.lyrics;
        collected.title = r.title;
        await ctx.log(`✅ Got "${r.title}" (${r.lyrics.length} chars)`);
        await ctx.progress(0.4);
        return { title: r.title, lyrics: r.lyrics };
      },
    }),

    generate_song: tool({
      description:
        "Generate a full song (vocals + music) from existing lyrics. Long-running (30–90 s). Returns mp3/flac/wav URLs and duration. ONE song per call.",
      inputSchema: z.object({
        lyrics: z
          .string()
          .min(10)
          .describe(
            "The complete lyrics to sing. Section markers like [Verse]/[Chorus] are supported.",
          ),
        style_prompt: z
          .string()
          .optional()
          .describe(
            "Genre + mood + instrumentation + vocal style. Example: 'indie folk, 90 BPM, melancholy, acoustic guitar, female vocal, soft'.",
          ),
        model: z
          .enum(["auto", "mureka-7.5", "mureka-9"])
          .optional()
          .describe(
            "Model to use. 'auto' (default) picks the latest. 'mureka-9' is the premium current model. 'mureka-7.5' is cheaper/faster.",
          ),
      }),
      execute: async ({ lyrics, style_prompt, model }) => {
        await ctx.log(
          `🎤 Producing song${style_prompt ? ` (${style_prompt})` : ""}…`,
        );
        await ctx.progress(0.5);
        const choices = await runWithMurekaSlot(ctx, "song", () =>
          generateSong({
            lyrics,
            prompt: style_prompt,
            model,
            onTick: (status, attempt) => {
              if (attempt % 5 === 0) {
                void ctx.log(`   …Mureka status: ${status} (${attempt * 2}s)`);
              }
            },
          }),
        );
        const rec = shape(choices[0], "song");
        collected.songs.push(rec);
        if (!collected.lyrics) collected.lyrics = lyrics;
        await ctx.log(`✅ Song ready (${rec.duration_seconds}s)`);
        await ctx.progress(0.95);
        return rec;
      },
    }),

    generate_instrumental: tool({
      description:
        "Generate an instrumental track (no vocals). Long-running (30–90 s). Returns mp3/flac/wav URLs and duration. Use this for background music, lo-fi, ambient, study music, etc.",
      inputSchema: z.object({
        style_prompt: z
          .string()
          .min(3)
          .describe(
            "Genre + mood + tempo + instrumentation. Example: 'lo-fi hip hop, 75 BPM, dreamy, jazz piano, soft drums, study vibe'.",
          ),
        model: z
          .enum(["auto", "mureka-5.5", "mureka-6"])
          .optional()
          .describe("Model to use. 'auto' (default) picks the latest."),
      }),
      execute: async ({ style_prompt, model }) => {
        await ctx.log(`🎹 Producing instrumental: ${style_prompt}`);
        await ctx.progress(0.5);
        const choices = await runWithMurekaSlot(ctx, "instrumental", () =>
          generateInstrumental({
            prompt: style_prompt,
            model,
            onTick: (status, attempt) => {
              if (attempt % 5 === 0) {
                void ctx.log(`   …Mureka status: ${status} (${attempt * 2}s)`);
              }
            },
          }),
        );
        const rec = shape(choices[0], "instrumental");
        collected.songs.push(rec);
        await ctx.log(`✅ Instrumental ready (${rec.duration_seconds}s)`);
        await ctx.progress(0.95);
        return rec;
      },
    }),
  } as const;

  return { tools, collected };
}
