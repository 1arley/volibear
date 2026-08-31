import { createOpencode, createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk';

export interface OpenCodeConnection {
  client: OpencodeClient;
  url: string;
  ownership: 'external' | 'volibear';
  close(): Promise<void>;
}

async function probe(client: OpencodeClient, directory: string, signal?: AbortSignal): Promise<void> {
  await client.app.agents({ query: { directory }, throwOnError: true, signal });
}

/** Owns one shared OpenCode connection and closes only servers it started. */
export class OpenCodeServerManager {
  private connection?: Promise<OpenCodeConnection>;

  constructor(private readonly startupTimeoutMs = 15_000) {}

  acquire(directory: string, signal?: AbortSignal): Promise<OpenCodeConnection> {
    this.connection ??= this.connect(directory, signal).catch((error) => {
      this.connection = undefined;
      throw error;
    });
    return this.connection;
  }

  private async connect(directory: string, signal?: AbortSignal): Promise<OpenCodeConnection> {
    const explicit = process.env.OPENCODE_SERVER_URL?.trim();
    if (explicit) return this.external(explicit, directory, signal);
    try {
      return await this.external('http://127.0.0.1:4096', directory, signal);
    } catch {
      // No usable known server. Start one owned by this Volibear process.
    }
    const opened = await createOpencode({
      hostname: '127.0.0.1', port: 0, timeout: this.startupTimeoutMs, signal,
    });
    return {
      client: opened.client,
      url: opened.server.url,
      ownership: 'volibear',
      close: async () => opened.server.close(),
    };
  }

  private async external(url: string, directory: string, signal?: AbortSignal): Promise<OpenCodeConnection> {
    const client = createOpencodeClient({ baseUrl: url, directory });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.startupTimeoutMs, 2_000));
    const relay = () => controller.abort();
    signal?.addEventListener('abort', relay, { once: true });
    try {
      await probe(client, directory, controller.signal);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', relay);
    }
    return { client, url, ownership: 'external', close: async () => undefined };
  }

  async close(): Promise<void> {
    if (!this.connection) return;
    const connection = await this.connection.catch(() => undefined);
    this.connection = undefined;
    if (connection?.ownership === 'volibear') await connection.close();
  }
}

export function unwrapSdkData<T>(response: T | { data?: T }): T {
  if (response && typeof response === 'object' && 'data' in response) {
    return (response as { data?: T }).data as T;
  }
  return response as T;
}
