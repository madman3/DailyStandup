import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  downloadTelegramVoiceBuffer,
  transcribeVoiceBufferWithGemini,
} from "../src/telegramVoice.js";

function makeFetchStub(responders) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const responder = responders.shift();
    if (!responder) throw new Error(`unexpected fetch call: ${url}`);
    return responder(url);
  };
  return { fetchImpl, calls };
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function binaryResponse(buffer, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    json: async () => ({}),
  };
}

describe("downloadTelegramVoiceBuffer", () => {
  it("calls getFile then the file CDN and returns a Buffer", async () => {
    const audio = Buffer.from("fake-ogg-bytes");
    const { fetchImpl, calls } = makeFetchStub([
      () => jsonResponse({ ok: true, result: { file_path: "voice/file_123.oga" } }),
      () => binaryResponse(audio),
    ]);

    const out = await downloadTelegramVoiceBuffer("FILE_ID_42", "TOKEN_X", { fetchImpl });

    assert.ok(Buffer.isBuffer(out), "result is a Buffer");
    assert.equal(out.toString("utf8"), "fake-ogg-bytes");
    assert.equal(calls.length, 2);
    assert.equal(
      calls[0],
      "https://api.telegram.org/botTOKEN_X/getFile?file_id=FILE_ID_42"
    );
    assert.equal(calls[1], "https://api.telegram.org/file/botTOKEN_X/voice/file_123.oga");
  });

  it("URL-encodes the file_id", async () => {
    const { fetchImpl, calls } = makeFetchStub([
      () => jsonResponse({ ok: true, result: { file_path: "voice/x.oga" } }),
      () => binaryResponse(Buffer.from("a")),
    ]);
    await downloadTelegramVoiceBuffer("a/b c", "TOK", { fetchImpl });
    assert.match(calls[0], /file_id=a%2Fb%20c$/);
  });

  it("throws when getFile returns ok=false", async () => {
    const { fetchImpl } = makeFetchStub([
      () => jsonResponse({ ok: false, description: "FILE_NOT_FOUND" }),
    ]);
    await assert.rejects(
      () => downloadTelegramVoiceBuffer("F", "T", { fetchImpl }),
      /Telegram getFile failed/
    );
  });

  it("throws when the file CDN returns non-OK", async () => {
    const { fetchImpl } = makeFetchStub([
      () => jsonResponse({ ok: true, result: { file_path: "voice/x.oga" } }),
      () => binaryResponse(Buffer.from(""), { ok: false, status: 502 }),
    ]);
    await assert.rejects(
      () => downloadTelegramVoiceBuffer("F", "T", { fetchImpl }),
      /HTTP 502/
    );
  });
});

describe("transcribeVoiceBufferWithGemini", () => {
  function makeFakeGemini({ text = "hello world", capture } = {}) {
    return () => ({
      getGenerativeModel: ({ model }) => {
        capture && (capture.modelName = model);
        return {
          generateContent: async (parts) => {
            capture && (capture.parts = parts);
            return {
              response: { text: () => text },
            };
          },
        };
      },
    });
  }

  it("sends the audio as inline base64 with the right mime and returns trimmed text", async () => {
    const captured = {};
    const buf = Buffer.from("opus-bytes");
    const out = await transcribeVoiceBufferWithGemini(buf, "audio/ogg", {
      apiKey: "key",
      clientFactory: makeFakeGemini({ text: "  hello world  ", capture: captured }),
    });

    assert.equal(out, "hello world");
    assert.equal(captured.modelName, "gemini-2.5-flash");
    assert.equal(captured.parts.length, 2);
    assert.equal(typeof captured.parts[0].text, "string");
    assert.match(captured.parts[0].text, /Transcribe this voice message/);
    assert.equal(captured.parts[1].inlineData.mimeType, "audio/ogg");
    assert.equal(
      captured.parts[1].inlineData.data,
      buf.toString("base64"),
      "audio is base64-encoded"
    );
  });

  it("defaults the mime type to audio/ogg when none supplied", async () => {
    const captured = {};
    await transcribeVoiceBufferWithGemini(Buffer.from("x"), undefined, {
      apiKey: "key",
      clientFactory: makeFakeGemini({ text: "ok", capture: captured }),
    });
    assert.equal(captured.parts[1].inlineData.mimeType, "audio/ogg");
  });

  it("honors GEMINI_MODEL via opts.modelName", async () => {
    const captured = {};
    await transcribeVoiceBufferWithGemini(Buffer.from("x"), "audio/ogg", {
      apiKey: "key",
      modelName: "gemini-2.5-flash-lite",
      clientFactory: makeFakeGemini({ text: "ok", capture: captured }),
    });
    assert.equal(captured.modelName, "gemini-2.5-flash-lite");
  });

  it("throws when GEMINI_API_KEY is missing", async () => {
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      await assert.rejects(
        () => transcribeVoiceBufferWithGemini(Buffer.from("x"), "audio/ogg"),
        /GEMINI_API_KEY not set/
      );
    } finally {
      if (original !== undefined) process.env.GEMINI_API_KEY = original;
    }
  });

  it("propagates errors thrown by the Gemini client", async () => {
    const failing = () => ({
      getGenerativeModel: () => ({
        generateContent: async () => {
          throw new Error("boom");
        },
      }),
    });
    await assert.rejects(
      () =>
        transcribeVoiceBufferWithGemini(Buffer.from("x"), "audio/ogg", {
          apiKey: "key",
          clientFactory: failing,
        }),
      /boom/
    );
  });

  it("rejects empty buffers up front", async () => {
    await assert.rejects(
      () =>
        transcribeVoiceBufferWithGemini(Buffer.alloc(0), "audio/ogg", { apiKey: "k" }),
      /empty audio buffer/
    );
  });
});
