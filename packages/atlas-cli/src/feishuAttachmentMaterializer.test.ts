import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { materializeFeishuAttachmentPrompt } from './feishuAttachmentMaterializer.js';
import type { LarkClient } from 'codelink-gateway';

function makeLarkClient() {
  const writeFile = vi.fn(async (targetPath: string) => {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, 'downloaded');
  });

  const client: LarkClient = {
    im: {
      message: {
        create: vi.fn(),
        reply: vi.fn(),
        patch: vi.fn(),
      },
      messageResource: {
        get: vi.fn(async () => ({
          writeFile,
          getReadableStream: vi.fn(),
          headers: {},
        })),
      },
    },
  };

  return {
    client,
    writeFile,
    getResource: vi.mocked(client.im.messageResource!.get),
  };
}

function makeRuntime(overrides?: Record<string, string>) {
  return {
    id: 'runtime-tmux-1',
    transport: 'tmux',
    provider: 'claude',
    capabilities: { fileAccess: true },
    metadata: {
      cwd: '/workspace/project',
      ...(overrides ?? {}),
    },
  } as any;
}

const createdDirs: string[] = [];

async function tempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('materializeFeishuAttachmentPrompt', () => {
  it('downloads a Feishu file attachment and returns a prompt with the saved path', async () => {
    const { client, getResource } = makeLarkClient();
    const uploadRoot = await tempDir('codelink-file-');

    const result = await materializeFeishuAttachmentPrompt(makeRuntime(), {
      channelId: 'feishu',
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      messageId: 'msg-file-1',
      content: { type: 'file', url: 'file-key-1', filename: 'report.pdf' },
      timestamp: Date.now(),
    }, {
      larkClient: client,
      uploadRoot,
    });

    expect(getResource).toHaveBeenCalledWith({
      params: { type: 'file' },
      path: { message_id: 'msg-file-1', file_key: 'file-key-1' },
    });
    expect(result).not.toBeNull();
    expect(result!.preview).toBe('(file) report.pdf');
    expect(result!.text).toContain('report.pdf');
    expect(result!.text).toContain(path.join(uploadRoot, 'runtime-tmux-1', 'report.pdf'));
  });

  it('downloads a Feishu image attachment and returns a prompt with the saved path', async () => {
    const { client, getResource } = makeLarkClient();
    const uploadRoot = await tempDir('codelink-image-');

    const result = await materializeFeishuAttachmentPrompt(makeRuntime(), {
      channelId: 'feishu',
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      messageId: 'msg-image-1',
      content: { type: 'image', url: 'img-key-1', mimeType: 'image/png' },
      timestamp: Date.now(),
    }, {
      larkClient: client,
      uploadRoot,
    });

    expect(getResource).toHaveBeenCalledWith({
      params: { type: 'image' },
      path: { message_id: 'msg-image-1', file_key: 'img-key-1' },
    });
    expect(result).not.toBeNull();
    expect(result!.preview).toContain('(image)');
    expect(result!.text).toContain('saved locally');
    expect(result!.text).toContain(path.join(uploadRoot, 'runtime-tmux-1'));
  });

  it('returns null for unsupported channels or attachment types', async () => {
    const { client, getResource } = makeLarkClient();
    const uploadRoot = await tempDir('codelink-ignore-');

    const nonFeishu = await materializeFeishuAttachmentPrompt(makeRuntime(), {
      channelId: 'dingtalk',
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      messageId: 'msg-file-1',
      content: { type: 'file', url: 'file-key-1', filename: 'report.pdf' },
      timestamp: Date.now(),
    }, {
      larkClient: client,
      uploadRoot,
    });

    const audio = await materializeFeishuAttachmentPrompt(makeRuntime(), {
      channelId: 'feishu',
      chatId: 'chat-1',
      userId: 'user-1',
      userName: 'User',
      messageId: 'msg-audio-1',
      content: { type: 'audio', url: 'audio-key-1' },
      timestamp: Date.now(),
    }, {
      larkClient: client,
      uploadRoot,
    });

    expect(nonFeishu).toBeNull();
    expect(audio).toBeNull();
    expect(getResource).not.toHaveBeenCalled();
  });
});
