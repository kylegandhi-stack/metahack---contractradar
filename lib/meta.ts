// Meta Model API client (OpenAI-compatible). Server-side only; the key never reaches a client bundle.
import OpenAI from "openai";
import { z } from "zod";

export const MODEL = "muse-spark-1.3";
const BASE_URL = "https://api.meta.ai/v1";
// The limit covers reasoning plus visible output, so small values return empty content.
const DEFAULT_MAX_COMPLETION_TOKENS = 8_000;
const RUN_TOKEN_BUDGET = 150_000;
// Measured on a small JSON call: default about 15s, low about 6s, minimal about 4s.
const DEFAULT_REASONING_EFFORT = "low";

export type MetaErrorCode = "RATE_LIMITED" | "UPSTREAM_ERROR" | "TIMEOUT";

export class MetaError extends Error {
  constructor(
    readonly code: MetaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MetaError";
  }
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!process.env.MODEL_API_KEY) {
    throw new MetaError("UPSTREAM_ERROR", "Model API key is not configured");
  }
  client ??= new OpenAI({ apiKey: process.env.MODEL_API_KEY, baseURL: BASE_URL, maxRetries: 1 });
  return client;
}

// Per-run limits: one instance per request. Exhausting it maps to RATE_LIMITED in docs/interface.md.
export class RunBudget {
  tokens = 0;
  calls: Record<string, number> = {};

  constructor(
    readonly signal?: AbortSignal,
    readonly tokenLimit = RUN_TOKEN_BUDGET,
  ) {}

  assertAvailable() {
    if (this.signal?.aborted) throw new MetaError("TIMEOUT", "Run exceeded the time cap");
    if (this.tokens >= this.tokenLimit) {
      throw new MetaError("RATE_LIMITED", "Per-run token budget exhausted");
    }
  }

  record(stage: string, totalTokens: number | undefined) {
    this.tokens += totalTokens ?? 0;
    this.calls[stage] = (this.calls[stage] ?? 0) + 1;
  }
}

function toMetaError(error: unknown, budget: RunBudget): Error {
  if (error instanceof MetaError) return error;
  if (budget.signal?.aborted) return new MetaError("TIMEOUT", "Run exceeded the time cap");
  if (error instanceof OpenAI.APIError) {
    if (error.status === 429) return new MetaError("RATE_LIMITED", "Meta API rate limit reached");
    return new MetaError("UPSTREAM_ERROR", `Meta API error (HTTP ${error.status ?? "unknown"})`);
  }
  return new MetaError("UPSTREAM_ERROR", "Meta API request failed");
}

type ChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

export async function createCompletion(
  stage: string,
  budget: RunBudget,
  params: Omit<ChatParams, "model">,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  budget.assertAvailable();
  try {
    const completion = await getClient().chat.completions.create(
      {
        max_completion_tokens: DEFAULT_MAX_COMPLETION_TOKENS,
        reasoning_effort: DEFAULT_REASONING_EFFORT,
        ...params,
        model: MODEL,
      },
      { signal: budget.signal },
    );
    budget.record(stage, completion.usage?.total_tokens);
    return completion;
  } catch (error) {
    throw toMetaError(error, budget);
  }
}

export type JsonCall<T> = {
  stage: string;
  budget: RunBudget;
  schema: z.ZodType<T>;
  system: string;
  user: string;
  maxCompletionTokens?: number;
  reasoningEffort?: "minimal" | "low";
};

// Structured model step. Output is always validated here; invalid output gets exactly one retry (T9),
// then fails rather than passing unvalidated data downstream.
export async function chatJson<T>(call: JsonCall<T>): Promise<T> {
  const jsonSchema = z.toJSONSchema(call.schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  let lastProblem = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: call.system },
      { role: "user", content: call.user },
    ];
    if (attempt > 0) {
      messages.push({
        role: "user",
        content: `Your previous output was rejected: ${lastProblem}. Return only JSON matching the schema.`,
      });
    }
    const completion = await createCompletion(call.stage, call.budget, {
      messages,
      max_completion_tokens: call.maxCompletionTokens ?? DEFAULT_MAX_COMPLETION_TOKENS,
      reasoning_effort: call.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
      response_format: {
        type: "json_schema",
        json_schema: { name: `${call.stage}_output`, schema: jsonSchema },
      },
    });
    const parsed = parseJsonOutput(completion.choices[0]?.message?.content, call.schema);
    if (parsed.ok) return parsed.value;
    lastProblem = parsed.problem;
  }
  throw new MetaError("UPSTREAM_ERROR", `${call.stage} returned invalid output after one retry`);
}

export function parseJsonOutput<T>(
  content: string | null | undefined,
  schema: z.ZodType<T>,
): { ok: true; value: T } | { ok: false; problem: string } {
  if (!content) return { ok: false, problem: "empty content" };
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return { ok: false, problem: "not valid JSON" };
  }
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, problem: z.prettifyError(result.error).slice(0, 500) };
}
