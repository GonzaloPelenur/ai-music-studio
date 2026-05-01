import { env } from "./env.js";

const BASE_URL = "https://api.mureka.ai";

export class MurekaConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MurekaConcurrencyError";
  }
}

export class MurekaError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "MurekaError";
  }
}

async function murekaPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.murekaApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    if (msg.toLowerCase().includes("concurrent requests limit")) {
      throw new MurekaConcurrencyError(msg);
    }
    throw new MurekaError(`Mureka ${path} failed: ${msg}`, res.status);
  }
  return json as T;
}

async function murekaGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${env.murekaApiKey}` },
  });
  const json = (await res.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  if (!res.ok) {
    throw new MurekaError(
      `Mureka ${path} failed: ${json?.error?.message ?? `HTTP ${res.status}`}`,
      res.status,
    );
  }
  return json as T;
}

// ─── Lyrics (synchronous, NOT subject to song-generation concurrency limit) ─

export interface LyricsResult {
  title: string;
  lyrics: string;
}

export async function generateLyrics(prompt: string): Promise<LyricsResult> {
  const r = await murekaPost<{ title?: string; lyrics?: string }>(
    "/v1/lyrics/generate",
    { prompt },
  );
  return { title: r.title ?? "", lyrics: r.lyrics ?? "" };
}

// ─── Song / Instrumental (async, gated by Convex queue at the call site) ───

export type SongModel = "auto" | "mureka-7.5" | "mureka-9";
export type InstrumentalModel = "auto" | "mureka-5.5" | "mureka-6";

export interface AudioChoice {
  id: string;
  url: string;
  flac_url?: string;
  wav_url?: string;
  duration: number; // milliseconds
}

interface TaskCreated {
  id: string;
  status: string;
}

interface TaskQuery {
  id: string;
  status: "preparing" | "running" | "succeeded" | "failed" | "cancelled" | "timeouted";
  choices?: AudioChoice[];
}

const TERMINAL_FAIL = new Set(["failed", "cancelled", "timeouted"]);

async function pollTask(
  endpoint: string,
  taskId: string,
  onTick?: (status: string, attempt: number) => void,
): Promise<AudioChoice[]> {
  const start = Date.now();
  const TIMEOUT_MS = 5 * 60 * 1000; // 5 min
  let attempt = 0;
  while (true) {
    if (Date.now() - start > TIMEOUT_MS) {
      throw new MurekaError(`Mureka ${endpoint}/${taskId} timed out after 5 min`);
    }
    const r = await murekaGet<TaskQuery>(`${endpoint}/${taskId}`);
    onTick?.(r.status, ++attempt);
    if (r.status === "succeeded") {
      const choices = r.choices ?? [];
      if (choices.length === 0) {
        throw new MurekaError(`Mureka ${endpoint}/${taskId} succeeded with no choices`);
      }
      return choices;
    }
    if (TERMINAL_FAIL.has(r.status)) {
      throw new MurekaError(`Mureka ${endpoint}/${taskId} ended in '${r.status}'`);
    }
    await new Promise((res) => setTimeout(res, 2_000));
  }
}

export interface GenerateSongArgs {
  lyrics: string;
  prompt?: string;
  model?: SongModel;
  onTick?: (status: string, attempt: number) => void;
}

export async function generateSong(args: GenerateSongArgs): Promise<AudioChoice[]> {
  const created = await murekaPost<TaskCreated>("/v1/song/generate", {
    lyrics: args.lyrics,
    prompt: args.prompt ?? "",
    model: args.model ?? "auto",
    n: 1, // hard-coded: always 1 song so cost is predictable
  });
  return pollTask("/v1/song/query", created.id, args.onTick);
}

export interface GenerateInstrumentalArgs {
  prompt: string;
  model?: InstrumentalModel;
  onTick?: (status: string, attempt: number) => void;
}

export async function generateInstrumental(
  args: GenerateInstrumentalArgs,
): Promise<AudioChoice[]> {
  const created = await murekaPost<TaskCreated>("/v1/instrumental/generate", {
    prompt: args.prompt,
    model: args.model ?? "auto",
    n: 1,
  });
  return pollTask("/v1/instrumental/query", created.id, args.onTick);
}
