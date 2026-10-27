import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserWithRefresh } from "@/lib/auth";
import { AssistantProviderError, AssistantUnavailableError, assistantInput, runAssistant, type AssistantEvent } from "@/lib/server/assistant-service";
import { isSameOriginRequest, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Streams newline-delimited JSON: "text" and "added" events while the model works, then one "done" event with the
 * history to send back next time, or one "error" event. Request problems (session, validation) stay plain JSON errors.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const user = await getCurrentUserWithRefresh();
  if (!user) return NextResponse.json({ error: "session" }, { status: 401 });
  const parsed = assistantInput.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "message" }, { status: 400 });
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      // If the user closes the chat mid-reply the run still finishes, so transactions already being saved aren't cut off.
      const send = (event: AssistantEvent | { type: "done" | "error"; [key: string]: unknown }) => {
        try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { /* client disconnected */ }
      };
      try {
        send({ type: "done", ...(await runAssistant(user.id, parsed.data, send)) });
      } catch (error) {
        if (error instanceof AssistantUnavailableError) send({ type: "error", error: "unavailable" });
        // A malformed or edited history is rejected by the provider ("conversation"); the client starts a fresh chat.
        else if (error instanceof AssistantProviderError) send({ type: "error", error: error.kind });
        else {
          console.error("[assistant] request failed:", error);
          send({ type: "error", error: "server" });
        }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
