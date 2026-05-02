import { AgentContext } from "@grexal/sdk";
import { generateText, stepCountIs } from "ai";
import { buildTools } from "./src/tools.js";
import { SYSTEM_PROMPT } from "./src/prompts.js";
import { env } from "./src/env.js";

export default async function run(ctx: AgentContext) {
  // Fail fast with friendly errors if env is incomplete.
  env.assertAiGatewayKey();
  env.murekaApiKey;
  env.convexUrl;

  const task = await ctx.task();
  const userPrompt = String(task.prompt ?? "").trim();
  if (!userPrompt) {
    throw new Error("`prompt` is required");
  }

  await ctx.log("🎵 AI Music Studio booting up…");
  await ctx.progress(0.05);

  const { tools, collected } = buildTools(ctx);

  const { text } = await generateText({
    model: "moonshotai/kimi-k2.5",
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    tools,
    stopWhen: stepCountIs(8),
  });

  await ctx.progress(1.0);

  const track = collected.songs[0];
  return {
    summary: text,
    lyrics: collected.lyrics ?? "",
    audio_mp3: track?.mp3,
    audio_flac: track?.flac,
    audio_wav: track?.wav,
    duration_seconds: track?.duration_seconds,
  };
}
