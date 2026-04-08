import "dotenv/config";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

const openRouterApiKey = process.env.OPENROUTER_API_KEY;
const openRouterBaseUrl =
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const modelName = process.env.MODEL_NAME ?? "openai/gpt-4o-mini";
const fallbackModelName = process.env.FALLBACK_MODEL_NAME?.trim();
const retryCount = Number(process.env.LLM_RETRY_COUNT ?? 2);
const retryDelayMs = Number(process.env.LLM_RETRY_DELAY_MS ?? 1200);

export class LlmRequestError extends Error {
  status?: number;
  model?: string;
  retriable: boolean;

  constructor(message: string, options?: { status?: number; model?: string; retriable?: boolean }) {
    super(message);
    this.name = "LlmRequestError";
    this.status = options?.status;
    this.model = options?.model;
    this.retriable = options?.retriable ?? false;
  }
}

function ensureLlmConfig() {
  if (!openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not set.");
  }
}

export function hasLlmConfig() {
  return Boolean(openRouterApiKey);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestChatCompletion(messages: ChatMessage[], model: string) {
  const response = await fetch(`${openRouterBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "DataPilot AI",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new LlmRequestError(`OpenRouter request failed: ${response.status} ${errorText}`, {
      status: response.status,
      model,
      retriable: response.status === 429 || response.status >= 500,
    });
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new LlmRequestError("OpenRouter returned an empty response.", {
      model,
    });
  }

  return content;
}

export async function createChatCompletion(messages: ChatMessage[]) {
  ensureLlmConfig();

  const modelsToTry = [modelName, fallbackModelName].filter(
    (value, index, list): value is string => Boolean(value) && list.indexOf(value) === index
  );

  let lastError: unknown;

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        return await requestChatCompletion(messages, model);
      } catch (error) {
        lastError = error;

        if (!(error instanceof LlmRequestError) || !error.retriable || attempt === retryCount) {
          break;
        }

        await sleep(retryDelayMs * (attempt + 1));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown LLM request failure.");
}
