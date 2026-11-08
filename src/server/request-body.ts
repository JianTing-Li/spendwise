/** Bounded bytes and time, including chunked bodies; never buffer an arbitrary request. */
export async function boundedText(request: Request): Promise<string> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > 2048)) throw new Error('invalid_input');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid_input');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel(); reject(new Error('invalid_input')); }, 5000); });
  try {
    const read = async () => {
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2048) { void reader.cancel(); throw new Error('invalid_input'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    };
    return await Promise.race([read(), timeout]);
  } finally { clearTimeout(timer); }
}

export async function boundedJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new Error("invalid_input");
  return JSON.parse(await boundedText(request)) as unknown;
}
