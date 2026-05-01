function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in .env locally or via 'grexal env set'.`,
    );
  }
  return v;
}

export const env = {
  get murekaApiKey(): string {
    return required("MUREKA_API_KEY");
  },
  get convexUrl(): string {
    return required("CONVEX_URL");
  },
  // AI_GATEWAY_API_KEY is read directly by the AI SDK gateway provider — we
  // only assert its presence early so we get a friendly error instead of an
  // opaque 401 from the provider deep inside generateText().
  assertAiGatewayKey(): void {
    required("AI_GATEWAY_API_KEY");
  },
};
