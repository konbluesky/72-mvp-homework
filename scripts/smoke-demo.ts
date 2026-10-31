import {
  SessionCreatedSchema,
  SessionSnapshotSchema,
  ServerEventSchema,
  type Receipt,
} from '@mira/protocol';
const base = process.env.DEMO_URL || 'http://localhost:8080';
const create = async () =>
  SessionCreatedSchema.parse(
    await (await fetch(`${base}/api/sessions`, { method: 'POST' })).json(),
  );
const session = await create();
if (session.mode !== 'mock') throw new Error('Smoke test is restricted to Mock mode');
const headers = {
  Authorization: `Bearer ${session.sessionToken}`,
  'X-Session-Id': session.sessionId,
  'Content-Type': 'application/json',
};
const turnId = crypto.randomUUID();
const identity = { sessionId: session.sessionId, generation: 1, turnId };
const post = async (path: string, body: unknown) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Unexpected HTTP ${response.status}`);
  return response;
};
await post(`/api/sessions/${session.sessionId}/turns`, {
  generation: 1,
  turnId,
  receipts: [],
  frozenTurns: [],
});
const stream = await post(`/api/sessions/${session.sessionId}/turns/${turnId}/input`, {
  generation: 1,
  inputId: crypto.randomUUID(),
  text: '能看看照片吗？',
});
if (!stream.headers.get('content-type')?.includes('text/event-stream') || !stream.body)
  throw new Error('Missing SSE');
const reader = stream.body.getReader();
const decoder = new TextDecoder();
let buffer = '',
  seq = 0,
  audioFiles = 0,
  audioBytes = 0,
  done = false;
let sawBeforeEof = false;
for (;;) {
  const result = await reader.read();
  if (result.done) break;
  buffer += decoder.decode(result.value, { stream: true });
  let offset: number;
  while ((offset = buffer.indexOf('\n\n')) >= 0) {
    const frame = buffer.slice(0, offset);
    buffer = buffer.slice(offset + 2);
    if (!frame.startsWith('data: ')) continue;
    const event = ServerEventSchema.parse(JSON.parse(frame.slice(6)));
    if (event.seq !== ++seq) throw new Error('Sequence gap');
    if (event.type === 'error') throw new Error(event.payload.code);
    if (event.type === 'audio.ready') {
      sawBeforeEof = true;
      const response = await fetch(`${base}${event.payload.audioUrl}`, { headers });
      if (!response.ok) throw new Error('Private audio download failed');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (new TextDecoder().decode(bytes.slice(0, 4)) !== 'RIFF') throw new Error('Not actual WAV');
      audioFiles++;
      audioBytes += bytes.length;
      const outsider = await create();
      const denied = await fetch(`${base}${event.payload.audioUrl}`, {
        headers: {
          Authorization: `Bearer ${outsider.sessionToken}`,
          'X-Session-Id': outsider.sessionId,
        },
      });
      if (denied.ok) throw new Error('Cross-session media leaked');
      await denied.body?.cancel();
      // This HTTP smoke simulates successful presentation; the browser E2E verifies actual rendering/playback.
      const receipts: Receipt[] = [
        ...event.payload.events.map((cue) => ({
          ...identity,
          receiptId: crypto.randomUUID(),
          targetId: cue.eventId,
          kind: cue.type,
          status: 'presented' as const,
        })),
        {
          ...identity,
          receiptId: crypto.randomUUID(),
          targetId: event.payload.segmentId,
          kind: 'segment',
          status: 'presented',
          mode: 'audio',
        },
      ];
      await post(`/api/sessions/${session.sessionId}/receipts`, { receipts });
    }
    if (event.type === 'reply.done') done = true;
  }
}
const state = SessionSnapshotSchema.parse(
  await (await fetch(`${base}/api/sessions/${session.sessionId}`, { headers })).json(),
);
if (
  !done ||
  !sawBeforeEof ||
  audioFiles !== 2 ||
  !state.scene.facts.photo_revealed ||
  !state.scene.facts.rain_softened
)
  throw new Error('Incomplete proxy round trip');
process.stdout.write(
  JSON.stringify({
    base,
    mode: session.mode,
    eventFrames: seq,
    audioFiles,
    audioBytes,
    sseBeforeEof: sawBeforeEof,
    confirmedFacts: state.scene.facts,
    crossSessionMedia: 'denied',
  }) + '\n',
);
