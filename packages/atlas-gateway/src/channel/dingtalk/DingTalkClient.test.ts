import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DingTalkClientImpl } from './DingTalkClient.js';
import type { HttpPostFn, DingTalkClientConfig } from './DingTalkClient.js';

const BASE_URL = 'https://api.dingtalk.com';

const config: DingTalkClientConfig = {
  appKey: 'test-key',
  appSecret: 'test-secret',
};

function tokenResponse(accessToken = 'tok-abc', expireIn = 7200) {
  return { status: 200, data: { accessToken, expireIn } };
}

function sendResponse(processQueryKey = 'pqk-123') {
  return { status: 200, data: { processQueryKey } };
}

describe('DingTalkClientImpl', () => {
  let httpPost: ReturnType<typeof vi.fn<HttpPostFn>>;
  let client: DingTalkClientImpl;

  beforeEach(() => {
    httpPost = vi.fn<HttpPostFn>();
    client = new DingTalkClientImpl(config, httpPost);
    vi.restoreAllMocks();
  });

  // ── Token caching ───────────────────────────────────────────────────────

  describe('getAccessToken', () => {
    it('caches the token on second call', async () => {
      httpPost.mockResolvedValueOnce(tokenResponse('tok-1', 7200));

      const t1 = await client.getAccessToken();
      const t2 = await client.getAccessToken();

      expect(t1).toBe('tok-1');
      expect(t2).toBe('tok-1');
      // token endpoint called only once
      expect(httpPost).toHaveBeenCalledTimes(1);
    });

    it('refreshes when time passes expiry minus buffer', async () => {
      const now = 1_000_000_000_000;
      const spy = vi.spyOn(Date, 'now');

      // First call at t=now
      spy.mockReturnValue(now);
      httpPost.mockResolvedValueOnce(tokenResponse('tok-old', 7200));
      const t1 = await client.getAccessToken();
      expect(t1).toBe('tok-old');

      // Advance time past expiry - 60s buffer: now + 7200*1000 - 60_000 = now + 7_140_000
      // At exactly the boundary, the condition `now < expiresAt - buffer` becomes false.
      spy.mockReturnValue(now + 7_140_000);
      httpPost.mockResolvedValueOnce(tokenResponse('tok-new', 7200));
      const t2 = await client.getAccessToken();
      expect(t2).toBe('tok-new');
      expect(httpPost).toHaveBeenCalledTimes(2);
    });

    it('throws when token API returns non-200', async () => {
      httpPost.mockResolvedValueOnce({ status: 500, data: {} });
      await expect(client.getAccessToken()).rejects.toThrow('DingTalk token request failed: status=500');
    });

    it('throws when response is missing accessToken', async () => {
      httpPost.mockResolvedValueOnce({ status: 200, data: {} });
      await expect(client.getAccessToken()).rejects.toThrow('DingTalk token response missing accessToken');
    });
  });

  // ── sendText ────────────────────────────────────────────────────────────

  describe('sendText', () => {
    it('sends correct URL and body', async () => {
      httpPost
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(sendResponse('pqk-text'));

      const key = await client.sendText('conv-1', 'hello');

      expect(key).toBe('pqk-text');
      // Second call is the sendText call
      expect(httpPost).toHaveBeenCalledTimes(2);
      const [url, body, headers] = httpPost.mock.calls[1];
      expect(url).toBe(`${BASE_URL}/v1.0/robot/groupMessages/send`);
      expect(body).toEqual({
        msgParam: JSON.stringify({ text: { content: 'hello' } }),
        msgKey: 'sampleText',
        openConversationId: 'conv-1',
      });
      expect(headers).toEqual({ 'x-acs-dingtalk-access-token': 'tok-abc' });
    });

    it('throws on non-200 response', async () => {
      httpPost
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce({ status: 403, data: {} });

      await expect(client.sendText('conv-1', 'hi')).rejects.toThrow('DingTalk sendText failed: status=403');
    });
  });

  // ── sendMarkdown ────────────────────────────────────────────────────────

  describe('sendMarkdown', () => {
    it('sends correct URL and body', async () => {
      httpPost
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(sendResponse('pqk-md'));

      const key = await client.sendMarkdown('conv-2', 'Title', '**bold**');

      expect(key).toBe('pqk-md');
      const [url, body, headers] = httpPost.mock.calls[1];
      expect(url).toBe(`${BASE_URL}/v1.0/robot/groupMessages/send`);
      expect(body).toEqual({
        msgParam: JSON.stringify({ markdown: { title: 'Title', text: '**bold**' } }),
        msgKey: 'sampleMarkdown',
        openConversationId: 'conv-2',
      });
      expect(headers).toEqual({ 'x-acs-dingtalk-access-token': 'tok-abc' });
    });

    it('throws on non-200 response', async () => {
      httpPost
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce({ status: 502, data: {} });

      await expect(client.sendMarkdown('conv-2', 'T', 'x')).rejects.toThrow(
        'DingTalk sendMarkdown failed: status=502',
      );
    });
  });

  // ── sendActionCard ──────────────────────────────────────────────────────

  describe('sendActionCard', () => {
    it('sends correct URL and body', async () => {
      const card = { title: 'Card', text: '# Hi' };
      httpPost
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(sendResponse('pqk-card'));

      const key = await client.sendActionCard('conv-3', card);

      expect(key).toBe('pqk-card');
      const [url, body] = httpPost.mock.calls[1];
      expect(url).toBe(`${BASE_URL}/v1.0/robot/groupMessages/send`);
      expect(body).toEqual({
        msgParam: JSON.stringify({ actionCard: card }),
        msgKey: 'sampleActionCard',
        openConversationId: 'conv-3',
      });
    });
  });

  // ── sendViaWebhook ──────────────────────────────────────────────────────

  describe('sendViaWebhook', () => {
    it('POSTs payload directly to webhook URL', async () => {
      const payload = { msgtype: 'text', text: { content: 'webhook msg' } };
      httpPost.mockResolvedValueOnce({ status: 200, data: {} });

      await client.sendViaWebhook('https://oapi.dingtalk.com/robot/send?token=xyz', payload);

      expect(httpPost).toHaveBeenCalledTimes(1);
      const [url, body] = httpPost.mock.calls[0];
      expect(url).toBe('https://oapi.dingtalk.com/robot/send?token=xyz');
      expect(body).toEqual(payload);
    });

    it('throws on non-200 response', async () => {
      httpPost.mockResolvedValueOnce({ status: 400, data: { errcode: 310000 } });

      await expect(
        client.sendViaWebhook('https://oapi.dingtalk.com/robot/send?token=bad', { msgtype: 'text' }),
      ).rejects.toThrow('DingTalk webhook send failed: status=400');
    });
  });

  // ── updateCard ──────────────────────────────────────────────────────────

  describe('updateCard', () => {
    it('logs warning and does not call httpPost', async () => {
      await client.updateCard('msg-1', { title: 'X', text: 'Y' });
      expect(httpPost).not.toHaveBeenCalled();
    });
  });
});
