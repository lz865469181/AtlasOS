import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { ChannelEvent, LarkClient, RuntimeSession } from 'codelink-gateway';
import type { MaterializedPrompt } from 'codelink-gateway';

function sanitizeFilename(name: string): string {
  const trimmed = name.trim();
  const sanitized = trimmed.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
  return sanitized || 'attachment.bin';
}

function extensionForMimeType(mimeType?: string): string {
  switch (mimeType?.toLowerCase()) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    default:
      return '.bin';
  }
}

function ensureSupportedRuntime(runtime: RuntimeSession): boolean {
  return runtime.transport === 'tmux' || runtime.capabilities.fileAccess;
}

function fileNameForEvent(event: ChannelEvent): string | null {
  if (event.content.type === 'file') {
    return sanitizeFilename(event.content.filename);
  }
  if (event.content.type === 'image') {
    return `feishu-image-${event.messageId}${extensionForMimeType(event.content.mimeType)}`;
  }
  return null;
}

export async function materializeFeishuAttachmentPrompt(
  runtime: RuntimeSession,
  event: ChannelEvent,
  deps: {
    larkClient: LarkClient | null;
    uploadRoot: string;
  },
): Promise<MaterializedPrompt | null> {
  if (event.channelId !== 'feishu') {
    return null;
  }
  if (!ensureSupportedRuntime(runtime)) {
    return null;
  }
  if (event.content.type !== 'file' && event.content.type !== 'image') {
    return null;
  }
  const resourceApi = deps.larkClient?.im.messageResource;
  if (!resourceApi) {
    throw new Error('Feishu message resource API is unavailable.');
  }

  const fileName = fileNameForEvent(event);
  if (!fileName) {
    return null;
  }

  const targetDir = path.join(deps.uploadRoot, runtime.id);
  const targetPath = path.join(targetDir, fileName);
  await fs.mkdir(targetDir, { recursive: true });

  const type = event.content.type;
  const fileKey = event.content.url;
  const resource = await resourceApi.get({
    params: { type },
    path: {
      message_id: event.messageId,
      file_key: fileKey,
    },
  });
  await resource.writeFile(targetPath);

  if (type === 'file') {
    return {
      text: [
        'A Feishu file attachment has been saved locally for this runtime.',
        `Path: ${targetPath}`,
        `Original filename: ${event.content.filename}`,
        'Please inspect this file and continue with the user request.',
      ].join('\n'),
      preview: `(file) ${event.content.filename}`,
    };
  }

  return {
    text: [
      'A Feishu image attachment has been saved locally for this runtime.',
      `Path: ${targetPath}`,
      'Please inspect this image and continue with the user request.',
    ].join('\n'),
    preview: `(image) ${path.basename(targetPath)}`,
  };
}
