import http from 'node:http';

/**
 * The few Docker Engine API calls the sandbox manager needs, over the local
 * socket (Linux) or named pipe (Docker Desktop on Windows). No dependency.
 */
export class DockerError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ContainerSummary {
  Id: string;
  Names: string[];
  State: string;
  Labels: Record<string, string>;
}

export interface ContainerInfo {
  Id: string;
  Name: string;
  State: { Running: boolean; Status: string; OOMKilled: boolean };
  NetworkSettings: {
    Ports: Record<string, { HostIp: string; HostPort: string }[] | null>;
    Networks: Record<string, { IPAddress: string }>;
  };
}

const API = '/v1.43';

/** Where Docker may listen, most likely first. DOCKER_HOST wins when set. */
function candidateSockets(): string[] {
  const host = process.env.DOCKER_HOST;
  if (host?.startsWith('unix://')) return [host.slice('unix://'.length)];
  if (host?.startsWith('npipe://')) return [host.slice('npipe://'.length).replace(/\//g, '\\')];
  // Docker Desktop on Windows: recent versions use the Linux-engine pipe, older ones docker_engine.
  return process.platform === 'win32' ? ['\\\\.\\pipe\\dockerDesktopLinuxEngine', '\\\\.\\pipe\\docker_engine'] : ['/var/run/docker.sock'];
}

export class DockerClient {
  private socketPath: string;

  constructor(private candidates = candidateSockets()) {
    this.socketPath = candidates[0]!;
  }

  private request<T>(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const req = http.request(
        {
          socketPath: this.socketPath,
          path: `${API}${path}`,
          method,
          headers: { host: 'docker', ...(payload && { 'content-type': 'application/json', 'content-length': payload.length }) },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;
            if (status >= 400) {
              let message = text;
              try {
                message = (JSON.parse(text) as { message?: string }).message ?? text;
              } catch {}
              return reject(new DockerError(status, message.trim()));
            }
            try {
              resolve((text ? JSON.parse(text) : undefined) as T);
            } catch {
              resolve(text as T);
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('Docker did not answer in time')));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  /** True when Docker answers; settles on the first socket that does. */
  async ping(): Promise<boolean> {
    for (const socket of this.candidates) {
      this.socketPath = socket;
      try {
        await this.request('GET', '/_ping', undefined, 3000);
        return true;
      } catch {
        // try the next one
      }
    }
    this.socketPath = this.candidates[0]!;
    return false;
  }

  list(labels: string[]): Promise<ContainerSummary[]> {
    const filters = encodeURIComponent(JSON.stringify({ label: labels }));
    return this.request('GET', `/containers/json?all=1&filters=${filters}`);
  }

  async create(name: string, spec: Record<string, unknown>): Promise<string> {
    const res = await this.request<{ Id: string }>('POST', `/containers/create?name=${encodeURIComponent(name)}`, spec);
    return res.Id;
  }

  start(id: string): Promise<void> {
    return this.request('POST', `/containers/${id}/start`);
  }

  inspect(id: string): Promise<ContainerInfo> {
    return this.request('GET', `/containers/${id}/json`);
  }

  /** Stops and deletes the container (its anonymous tmpfs go with it; bind mounts stay). */
  async remove(id: string): Promise<void> {
    await this.request('DELETE', `/containers/${id}?force=1&v=1`).catch((err: unknown) => {
      if (!(err instanceof DockerError && err.status === 404)) throw err;
    });
  }

  /** One sample of CPU (percent of one core) and memory. */
  async stats(id: string): Promise<{ cpuPercent: number; memMb: number }> {
    const s = await this.request<{
      cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number; online_cpus: number };
      precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
      memory_stats: { usage?: number; stats?: { inactive_file?: number } };
    }>('GET', `/containers/${id}/stats?stream=false`, undefined, 10_000);
    const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
    const systemDelta = s.cpu_stats.system_cpu_usage - (s.precpu_stats.system_cpu_usage ?? 0);
    const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * (s.cpu_stats.online_cpus || 1) * 100 : 0;
    const mem = (s.memory_stats.usage ?? 0) - (s.memory_stats.stats?.inactive_file ?? 0);
    return { cpuPercent: Math.round(cpuPercent * 10) / 10, memMb: Math.round(mem / 1048576) };
  }

  /** The container's total CPU time so far (ns, all its processes), or null when it is gone. */
  async cpuTotal(id: string): Promise<number | null> {
    try {
      const s = await this.request<{ cpu_stats?: { cpu_usage?: { total_usage?: number } } }>(
        'GET',
        `/containers/${id}/stats?stream=false&one-shot=true`,
        undefined,
        10_000,
      );
      const ns = s.cpu_stats?.cpu_usage?.total_usage;
      return typeof ns === 'number' ? ns : null;
    } catch (err) {
      if (err instanceof DockerError && err.status === 404) return null;
      throw err;
    }
  }

  /** Changes a running container's limits (e.g. NanoCpus to slow it down). */
  async update(id: string, limits: { NanoCpus?: number }): Promise<void> {
    await this.request('POST', `/containers/${id}/update`, limits);
  }

  async imageExists(ref: string): Promise<boolean> {
    try {
      await this.request('GET', `/images/${encodeURIComponent(ref)}/json`);
      return true;
    } catch (err) {
      if (err instanceof DockerError && err.status === 404) return false;
      throw err;
    }
  }

  /** Pulls an image (blocks until done; Docker streams progress, we wait for the end). */
  async pull(ref: string): Promise<void> {
    const [image, tag = 'latest'] = ref.split(/:(?=[^/]+$)/);
    await this.request('POST', `/images/create?fromImage=${encodeURIComponent(image!)}&tag=${encodeURIComponent(tag)}`, undefined, 15 * 60_000);
  }

  /** Joins a container (e.g. this backend's own) to a network; no error if it already is. */
  async connect(network: string, container: string): Promise<void> {
    await this.request('POST', `/networks/${encodeURIComponent(network)}/connect`, { Container: container }).catch((err: unknown) => {
      if (!(err instanceof DockerError && (err.status === 403 || /already exists|already attached/i.test(err.message)))) throw err;
    });
  }

  async ensureNetwork(name: string): Promise<void> {
    try {
      await this.request('GET', `/networks/${encodeURIComponent(name)}`);
    } catch (err) {
      if (!(err instanceof DockerError && err.status === 404)) throw err;
      await this.request('POST', '/networks/create', { Name: name, Driver: 'bridge', Labels: { 'studyhawk.sandbox': '1' } });
    }
  }
}
