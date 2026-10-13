/** Server-only inference adapter. No model response, URL credential or key is logged. */
export class ModelError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const integer = (value, fallback, min, max) => {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new ModelError(
      'MODEL_CONFIG',
      `Model settings must be integers within ${min}–${max}.`,
      503,
    );
  return n;
};
export function modelConfig(env = process.env) {
  const provider = env.WORKBENCH_AI_PROVIDER || 'ollama';
  if (!['ollama', 'openai-compatible'].includes(provider))
    throw new ModelError('MODEL_CONFIG', 'Unsupported model provider.', 503);
  let base;
  try {
    base = new URL(
      env.WORKBENCH_AI_BASE_URL ||
        (provider === 'ollama'
          ? 'http://127.0.0.1:11434'
          : 'http://127.0.0.1:1234/v1'),
    );
  } catch {
    throw new ModelError('MODEL_CONFIG', 'Invalid model service URL.', 503);
  }
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new ModelError(
      'MODEL_CONFIG',
      'Use an HTTP(S) base URL without credentials, query or fragment.',
      503,
    );
  const model = env.WORKBENCH_AI_MODEL || '';
  if (model.length > 200)
    throw new ModelError('MODEL_CONFIG', 'Model name is too long.', 503);
  const contextLength = integer(env.WORKBENCH_AI_CONTEXT, 4096, 1024, 32768);
  const maxTokens = integer(env.WORKBENCH_AI_MAX_TOKENS, 768, 64, 4096);
  if (maxTokens >= contextLength)
    throw new ModelError(
      'MODEL_CONFIG',
      'Output limit must be smaller than context length.',
      503,
    );
  return {
    provider,
    baseUrl: base.href.replace(/\/$/, ''),
    model,
    timeoutMs: integer(env.WORKBENCH_AI_TIMEOUT_MS, 120000, 100, 600000),
    contextLength,
    maxTokens,
    apiKey: env.WORKBENCH_AI_API_KEY || '',
  };
}
export function publicModelConfig(config) {
  return {
    provider: config.provider,
    model: config.model,
    timeoutMs: config.timeoutMs,
    contextLength: config.contextLength,
    maxTokens: config.maxTokens,
    configured: Boolean(config.model),
  };
}
async function boundedJson(response) {
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 256 * 1024)
      throw new ModelError('MODEL_FORMAT', 'Model response exceeded 256 KiB.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ModelError(
      'MODEL_FORMAT',
      'Model service returned invalid JSON.',
    );
  }
}
export function createModelService({
  config = modelConfig(),
  fetchImpl = fetch,
} = {}) {
  let busy = false;
  const request = async (suffix, body, method = 'POST') => {
    if (busy)
      throw new ModelError(
        'MODEL_BUSY',
        'Another model request is running. Retry after it finishes.',
        409,
      );
    busy = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(`${config.baseUrl}/${suffix}`, {
        method,
        signal: controller.signal,
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey
            ? { Authorization: `Bearer ${config.apiKey}` }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ModelError(
          'MODEL_HTTP',
          `Model service returned HTTP ${response.status}. Check model name and server settings.`,
        );
      }
      return await boundedJson(response);
    } catch (error) {
      if (controller.signal.aborted)
        throw new ModelError(
          'MODEL_TIMEOUT',
          'Model request timed out. Previous content is retained.',
          504,
        );
      if (error instanceof ModelError) throw error;
      throw new ModelError(
        'MODEL_UNAVAILABLE',
        'Cannot connect to the model service from the local backend. Check its address and startup status.',
      );
    } finally {
      clearTimeout(timer);
      busy = false;
    }
  };
  return {
    config,
    async probe() {
      const data = await request(
        config.provider === 'ollama' ? 'api/tags' : 'models',
        undefined,
        'GET',
      );
      const names =
        config.provider === 'ollama'
          ? data.models?.map((m) => m.name)
          : data.data?.map((m) => m.id);
      if (!Array.isArray(names) || names.some((n) => typeof n !== 'string'))
        throw new ModelError('MODEL_FORMAT', 'Invalid model list.');
      return {
        reachable: true,
        modelAvailable: names.includes(config.model),
        models: names.slice(0, 100),
      };
    },
    async generate(messages, schema) {
      if (!config.model)
        throw new ModelError(
          'MODEL_CONFIG',
          'Set WORKBENCH_AI_MODEL in the backend environment, then restart the platform.',
          503,
        );
      // Conservative byte budget prevents silent truncation; provider tokenizers vary.
      const promptBytes = Buffer.byteLength(JSON.stringify(messages));
      if (promptBytes + config.maxTokens + 256 > config.contextLength)
        throw new ModelError(
          'MODEL_CONTEXT',
          'Input exceeds the conservative context budget. Select fewer source items or shorten scene/adjustment text.',
          413,
        );
      const body =
        config.provider === 'ollama'
          ? {
              model: config.model,
              messages,
              stream: false,
              format: schema,
              think: false,
              options: {
                num_ctx: config.contextLength,
                num_predict: config.maxTokens,
                num_gpu: 0,
                temperature: 0.2,
              },
            }
          : {
              model: config.model,
              messages,
              stream: false,
              max_tokens: config.maxTokens,
              temperature: 0.2,
              response_format: {
                type: 'json_schema',
                json_schema: { name: 'daily_digest', strict: true, schema },
              },
            };
      const data = await request(
        config.provider === 'ollama' ? 'api/chat' : 'chat/completions',
        body,
      );
      if (
        data.done_reason === 'length' ||
        data.choices?.[0]?.finish_reason === 'length'
      )
        throw new ModelError(
          'MODEL_FORMAT',
          'Output token limit reached. Reduce selected items or increase the bounded output limit.',
        );
      const content =
        config.provider === 'ollama'
          ? data.message?.content
          : data.choices?.[0]?.message?.content;
      if (typeof content !== 'string')
        throw new ModelError(
          'MODEL_FORMAT',
          'Model response has no text content.',
        );
      try {
        return JSON.parse(content);
      } catch {
        throw new ModelError(
          'MODEL_FORMAT',
          'Model output is not valid JSON. Retry or use the original digest.',
        );
      }
    },
  };
}

/** Lazy validation keeps the original platform usable even with incorrect AI settings. */
export function createEnvironmentModelService() {
  let service;
  const get = () => (service ||= createModelService());
  return {
    get config() {
      return get().config;
    },
    probe: () => get().probe(),
    generate: (...args) => get().generate(...args),
  };
}
