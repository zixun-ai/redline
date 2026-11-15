import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_DEFAULTS, MAX_INPUT_CHARS, MAX_RESPONSE_CHARS, auditResume, chatJson, parseTailor, testKey, validateAiSettings } from "./deepseek";
import { CLOSED, dialogs, resuming } from "./dialogs";
import { sampleDoc } from "./sample";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const encoder = new TextEncoder();
const event = (content: string | null, finish: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\r\n\r\n`;
const standard = (content: unknown, finish = "stop") => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }] }), { headers: { "Content-Type": "application/json" } });

function streaming(text: string, size = 17, close = true) {
  const bytes = encoder.encode(text);
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size)); if (close) controller.close(); },
    cancel,
  });
  return { response: new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8" } }), cancel };
}

describe("AI endpoint settings", () => {
  it.each(["https://api.example.test/v1/", "http://localhost:11434/v1", "http://127.0.0.1:8080", "http://[::1]:1234/v1"])("accepts secure or local endpoints: %s", (baseUrl) => {
    expect(validateAiSettings({ baseUrl, model: " custom/model:v1 " })).toEqual({ baseUrl: baseUrl.replace(/\/+$/, ""), model: "custom/model:v1" });
  });

  it.each(["http://api.example.test", "javascript:alert(1)", "file:///tmp/api", "https://user:secret@api.example.test", "https://api.example.test?key=secret", "https://api.example.test/#part", "https://api.example.test/?", "invalid"])("rejects unsafe URLs before sending the key: %s", async (baseUrl) => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(testKey("fake-key", undefined, { baseUrl, model: "model" })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["", " ", "model\nname", "m".repeat(129)])("rejects invalid model names", (model) => {
    expect(() => validateAiSettings({ ...AI_DEFAULTS, model })).toThrow("模型名称");
  });

  it.each(["https://api.example.test/v1", "https://api.example.test/v1/chat/completions"])("uses the configured endpoint once without provider-only fields: %s", async (baseUrl) => {
    vi.stubGlobal("fetch", vi.fn(async () => standard('{"ok":true}')));
    await expect(chatJson("fake-key", [], 100, undefined, { baseUrl, model: "custom/model" })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/chat/completions");
    expect(options).toMatchObject({ credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({ model: "custom/model", stream: true, max_tokens: 100 });
    expect(body).not.toHaveProperty("thinking");
  });

  it("keeps the verified default model and uses one token for key checks", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => standard("", "length")));
    await testKey("fake-key");
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body).toMatchObject({ model: "deepseek-flash", stream: false, max_tokens: 1, thinking: { type: "disabled" } });
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it.each([{}, { error: { message: "private provider error" } }, { choices: [] }, { choices: [{ message: {} }] }, { choices: [{ message: { content: 42 } }] }, { error: "failed", choices: [{ message: { content: "ok" } }] }])("does not accept an HTTP 200 response without a valid completion", async (body) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
    await expect(testKey("fake-key")).rejects.toThrow("有效的对话结果");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not mark a blocked or aborted completion as a verified key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => standard("", "content_filter")));
    await expect(testKey("fake-key")).rejects.toThrow("内容审核");
  });
});

describe("bounded non-streaming JSON responses", () => {
  const jsonResponse = (text: string, size: number, close = true) => {
    const result = streaming(text, size, close);
    return { ...result, response: new Response(result.response.body, { headers: { "Content-Type": "application/json" } }) };
  };

  it("decodes UTF-8 JSON split across individual bytes", async () => {
    const payload = { reply: "中文🌊" };
    const response = jsonResponse(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), 1).response;
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(chatJson("fake-key", [], 100)).resolves.toEqual(payload);
    expect(response.body?.locked).toBe(false);
  });

  it("limits the whole response before JSON parsing, including unused fields", async () => {
    const { response, cancel } = jsonResponse('{"padding":"' + "x".repeat(4 * 1024 * 1024), 64 * 1024, false);
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(chatJson("fake-key", [], 100)).rejects.toThrow("回复过长");
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("cancels a pending JSON body without waiting for EOF", async () => {
    const { response, cancel } = jsonResponse('{"choices":', 3, false);
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const controller = new AbortController();
    const pending = chatJson("fake-key", [], 100, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(response.body?.locked).toBe(true));
    controller.abort();
    await rejection;
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it("rejects malformed UTF-8 instead of silently replacing text", async () => {
    const response = new Response(new Uint8Array([123, 34, 0xc3, 34, 125]), { headers: { "Content-Type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(chatJson("fake-key", [], 100)).rejects.toThrow("JSON");
  });
});

describe("streamed JSON responses", () => {
  it("recognizes the MIME type regardless of casing", async () => {
    const { response } = streaming(event('{"ok":true}', "stop") + "data: [DONE]\n\n");
    response.headers.set("Content-Type", "Text/Event-Stream; charset=UTF-8");
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(chatJson("fake-key", [], 100)).resolves.toEqual({ ok: true });
  });

  it.each([1, 2, 7, 31])("decodes UTF-8, split CRLF, comments and multi-line data with %i-byte chunks", async (size) => {
    const payload = { reply: "你好🌊", ok: true };
    const json = JSON.stringify(payload);
    const text = ": keepalive\r\n\r\nevent: message\r\ndata: {\r\ndata: \"choices\": [{\"delta\": {\"content\": " + JSON.stringify(json.slice(0, 10)) + "}, \"finish_reason\": null}]}\r\n\r\n"
      + event(json.slice(10), "stop") + 'data: {"choices":[],"usage":{"total_tokens":20}}\r\n\r\ndata: [DONE]\r\n\r\n';
    vi.stubGlobal("fetch", vi.fn(async () => streaming(text, size).response));
    const progress = vi.fn();
    await expect(chatJson("fake-key", [], 100, undefined, undefined, progress)).resolves.toEqual(payload);
    expect(progress.mock.calls[0]).toEqual([0]);
    expect(progress.mock.calls.some(([count]) => count > 0 && count < json.length)).toBe(true);
    expect(progress.mock.calls.at(-1)).toEqual([json.length]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("accepts DONE without waiting for the server to close and cancels the reader", async () => {
    const { response, cancel } = streaming(event('{"ok":true}', "stop") + "data: [DONE]\n\n", 19, false);
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(chatJson("fake-key", [], 100)).resolves.toEqual({ ok: true });
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it("does not apply syntactically valid partial JSON and cancels a pending reader", async () => {
    const { response, cancel } = streaming(event('{"ok":true}'), 17, false);
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const controller = new AbortController();
    const applied = vi.fn(), progress = vi.fn();
    const pending = chatJson("fake-key", [], 100, controller.signal, undefined, progress).then(applied);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(progress).toHaveBeenCalledWith(11));
    expect(applied).not.toHaveBeenCalled();
    controller.abort();
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    expect(applied).not.toHaveBeenCalled();
    expect(response.body?.locked).toBe(false);
  });

  it("rejects EOF without a completion marker, even when the partial JSON parses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streaming(event('{"ok":true}')).response));
    await expect(chatJson("fake-key", [], 100)).rejects.toThrow("中途断开");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["length", "content_filter", "tool_calls", "insufficient_system_resource", "aborted"])("rejects non-success finish_reason %s without retry", async (finish) => {
    vi.stubGlobal("fetch", vi.fn(async () => streaming(event('{"ok":true}', finish) + "data: [DONE]\n\n").response));
    await expect(chatJson("fake-key", [], 100)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(['data: invalid\n\n', 'data: {"error":{"message":"server internal secret"}}\n\n', 'data: {"choices":[{"delta":{"content":22}}]}\n\n'])("rejects malformed/error frames and closes the reader", async (frame) => {
    const { response, cancel } = streaming(frame, 64, false);
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(chatJson("fake-key", [], 100)).rejects.toThrow(/格式/);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("bounds generated text even if the server ignores max_tokens", async () => {
    const { response, cancel } = streaming(event("字".repeat(MAX_RESPONSE_CHARS + 1)), 1_000_000, false);
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(chatJson("fake-key", [], 100)).rejects.toThrow("回复过长");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("bounds stream bytes even when the server only sends comments", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streaming(":" + "x".repeat(4 * 1024 * 1024), 5 * 1024 * 1024).response));
    await expect(chatJson("fake-key", [], 100)).rejects.toThrow("回复过长");
  });

  it.each(["", "  ", "{broken", { unexpected: true }])("does not resend blank or malformed non-stream responses", async (content) => {
    vi.stubGlobal("fetch", vi.fn(async () => standard(content)));
    await expect(chatJson("fake-key", [], 100)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("resume audit and matching summaries", () => {
  it("audits only body passages without personal fields, photos, dates or a job description", async () => {
    const resume = sampleDoc().resume;
    resume.basics = { ...resume.basics, name: "不发送的姓名", phone: "13398761234", email: "private@example.invalid" };
    resume.photo = "data:image/jpeg;base64,PRIVATEPHOTO";
    vi.stubGlobal("fetch", vi.fn(async () => standard(JSON.stringify({ summary: "需要补充成果", missing: ["待填写：相关成果"], matched: ["原文已有协作经验"], edits: [] }))));
    const result = await auditResume("fake-key", resume);
    expect(result.matched).toEqual(["原文已有协作经验"]);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    const sent = JSON.stringify(body.messages);
    for (const hidden of [resume.basics.name, resume.basics.phone, resume.basics.email, resume.photo, "2022.03"]) expect(sent).not.toContain(hidden);
    expect(sent).toContain(resume.summary.text);
    expect(sent).toContain("不能断言存在工作空档");
    expect(sent).toContain("本次没有岗位描述");
  });

  it("rejects oversized audit context before requesting the model", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const resume = sampleDoc().resume;
    resume.summary.text = "字".repeat(MAX_INPUT_CHARS + 1);
    await expect(auditResume("fake-key", resume)).rejects.toThrow("文字超过");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["missing", "matched"])("validates the %s list count and item length", (key) => {
    const resume = sampleDoc().resume;
    for (const value of ["wrong", [22], [""], ["字".repeat(401)], Array(9).fill("一项")]) {
      expect(() => parseTailor({ missing: ["有效项"], [key]: value }, resume)).toThrow("匹配说明");
    }
    expect(parseTailor({ [key]: Array(8).fill("字".repeat(400)) }, resume)[key as "missing" | "matched"]).toHaveLength(8);
  });

  it("returns from the audit key detour once and does not auto-run after closing it", () => {
    const audit = dialogs(CLOSED, { type: "open", name: "audit" });
    const key = dialogs(audit, { type: "needKey", from: "audit" });
    expect(dialogs(key, { type: "keyClosed" })).toEqual({ open: "audit", resume: false });
    const saved = dialogs(key, { type: "keySaved", key: "fake" });
    expect(resuming(saved, "audit")).toBe(true);
    expect(resuming(dialogs(saved, { type: "resumed" }), "audit")).toBe(false);
  });
});
