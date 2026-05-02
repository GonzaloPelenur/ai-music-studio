import type { AgentContext } from "@grexal/sdk";
import { tool } from "ai";
import { z } from "zod";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  generateLyrics,
  generateSong,
  generateInstrumental,
  type AudioChoice,
} from "./mureka.js";
import { runWithMurekaSlot } from "./runWithMurekaSlot.js";

type FileReference = Awaited<ReturnType<AgentContext["uploadFile"]>>;

export interface CollectedArtefacts {
  lyrics?: string;
  title?: string;
  songs: SongRecord[];
}

export interface SongRecord {
  kind: "song" | "instrumental";
  duration_seconds: number;
  mp3: FileReference;
  flac?: FileReference;
  wav?: FileReference;
}

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  flac: "audio/flac",
  wav: "audio/wav",
};

async function uploadFromUrl(
  ctx: AgentContext,
  url: string,
  filename: string,
  description: string,
): Promise<FileReference> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${filename}: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const tmpPath = join(tmpdir(), `${randomBytes(6).toString("hex")}-${filename}`);
  await writeFile(tmpPath, buf);
  await ctx.log(`   ⬆️  Uploading ${filename} (${(buf.length / 1024).toFixed(0)} KB)…`);
  try {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const ref = await ctx.uploadFile(tmpPath, {
      name: filename,
      mimeType: MIME_BY_EXT[ext],
      description,
    });
    await ctx.log(`   ✓ Uploaded ${filename} → ${ref.id}`);
    return ref;
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await ctx.log(`   ✗ Upload failed for ${filename}: ${msg}`);
    throw err;
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

async function uploadAudioChoice(
  ctx: AgentContext,
  choice: AudioChoice,
  kind: SongRecord["kind"],
): Promise<SongRecord> {
  const baseDesc = kind === "song" ? "Generated song" : "Generated instrumental";
  const [mp3, flac, wav] = await Promise.all([
    uploadFromUrl(ctx, choice.url, `${kind}.mp3`, `${baseDesc} (MP3)`),
    choice.flac_url
      ? uploadFromUrl(ctx, choice.flac_url, `${kind}.flac`, `${baseDesc} (FLAC, lossless)`)
      : Promise.resolve(undefined),
    choice.wav_url
      ? uploadFromUrl(ctx, choice.wav_url, `${kind}.wav`, `${baseDesc} (WAV, uncompressed)`)
      : Promise.resolve(undefined),
  ]);
  return {
    kind,
    duration_seconds: Math.round(choice.duration / 1000),
    mp3,
    flac,
    wav,
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
        "Generate a full song (vocals + music) from existing lyrics. Long-running (30–90 s). Returns Grexal-hosted mp3/flac/wav file references and duration. ONE song per call.",
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
        await ctx.log(`📦 Uploading song to Grexal…`);
        const rec = await uploadAudioChoice(ctx, choices[0], "song");
        collected.songs.push(rec);
        if (!collected.lyrics) collected.lyrics = lyrics;
        await ctx.log(`✅ Song ready (${rec.duration_seconds}s)`);
        await ctx.progress(0.95);
        return rec;
      },
    }),

    generate_instrumental: tool({
      description:
        "Generate an instrumental track (no vocals). Long-running (30–90 s). Returns Grexal-hosted mp3/flac/wav file references and duration. Use this for background music, lo-fi, ambient, study music, etc.",
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
        await ctx.log(`📦 Uploading instrumental to Grexal…`);
        const rec = await uploadAudioChoice(ctx, choices[0], "instrumental");
        collected.songs.push(rec);
        await ctx.log(`✅ Instrumental ready (${rec.duration_seconds}s)`);
        await ctx.progress(0.95);
        return rec;
      },
    }),
  } as const;

  return { tools, collected };
}
