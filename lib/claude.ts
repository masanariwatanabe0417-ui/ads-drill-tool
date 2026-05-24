export function extractBase64(dataUrl: string): { base64: string; mediaType: string } {
  const mediaType = dataUrl.split(";")[0].split(":")[1];
  const base64 = dataUrl.split(",")[1];
  return { base64, mediaType };
}

export function buildImageBlock(dataUrl: string) {
  const { base64, mediaType } = extractBase64(dataUrl);
  return {
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
      data: base64,
    },
  };
}
