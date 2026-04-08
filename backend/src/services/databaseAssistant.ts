import { executeMcpTool, getMcpSchemaContext, listMcpTools } from "../mcp/server";
import type { ToolSource } from "../mcp/types";
import { createChatCompletion, hasLlmConfig, LlmRequestError } from "./llmClient";

type AssistantReply = {
  content: string;
  query: string;
  source: ToolSource;
};

type LlmDecision =
  | {
      type: "tool";
      input: string;
    }
  | {
      type: "final";
      content: string;
    };

const MAX_TOOL_STEPS = 6;

function buildSystemPrompt() {
  const tools = listMcpTools()
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");

  return [
    "You are a database assistant.",
    "You never access the database directly.",
    "You must use MCP tools whenever schema lookup or SQL execution is needed.",
    "If you need a tool, respond with JSON only: {\"type\":\"tool\",\"input\":\"tool:list_tables\"}",
    "If you can answer the user, respond with JSON only: {\"type\":\"final\",\"content\":\"...\"}",
    "Use only one tool call per turn.",
    "For SQL execution, use the format: sql: SELECT ...",
    "Do not generate write queries. Only read-only analysis is allowed.",
    "",
    "Available tools:",
    tools,
  ].join("\n");
}

function extractJsonObject(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM response did not contain a JSON object.");
  }

  return candidate.slice(start, end + 1);
}

function parseLlmDecision(raw: string): LlmDecision {
  const parsed = JSON.parse(extractJsonObject(raw)) as Partial<LlmDecision>;

  if (parsed.type === "tool" && typeof parsed.input === "string" && parsed.input.trim()) {
    return {
      type: "tool",
      input: parsed.input.trim(),
    };
  }

  if (
    parsed.type === "final" &&
    typeof parsed.content === "string" &&
    parsed.content.trim()
  ) {
    return {
      type: "final",
      content: parsed.content.trim(),
    };
  }

  throw new Error("LLM response JSON was not in the expected format.");
}

function buildFallbackReply(schemaContext: string) {
  return [
    "The LLM API is not configured yet, but the MCP layer is ready.",
    "Set OPENROUTER_API_KEY, MODEL_NAME, and OPENROUTER_BASE_URL to enable live reasoning.",
    "",
    schemaContext,
  ].join("\n");
}

function buildLlmErrorReply(error: LlmRequestError) {
  if (error.status === 429) {
    return "The model provider is rate-limited right now. Please try again in a moment.";
  }

  if (error.status === 401 || error.status === 403) {
    return "The LLM API key or provider access is not valid for this request.";
  }

  return "The LLM provider could not complete the request right now. Please try again shortly.";
}

export async function generateAssistantReply(input: string): Promise<AssistantReply> {
  const schemaContext = await getMcpSchemaContext();

  if (!hasLlmConfig()) {
    return {
      content: buildFallbackReply(schemaContext.content),
      query: schemaContext.query,
      source: "schema",
    };
  }

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content: buildSystemPrompt(),
    },
    {
      role: "assistant",
      content: `Schema context:\n${schemaContext.content}`,
    },
    {
      role: "user",
      content: input,
    },
  ];

  let lastQuery = schemaContext.query;
  let lastSource: ToolSource = schemaContext.source;

  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    let rawResponse: string;

    try {
      rawResponse = await createChatCompletion(messages);
    } catch (error) {
      if (error instanceof LlmRequestError) {
        return {
          content: buildLlmErrorReply(error),
          query: lastQuery,
          source: lastSource,
        };
      }

      throw error;
    }

    let decision: LlmDecision;

    try {
      decision = parseLlmDecision(rawResponse);
    } catch {
      return {
        content: rawResponse,
        query: lastQuery,
        source: lastSource,
      };
    }

    messages.push({
      role: "assistant",
      content: rawResponse,
    });

    if (decision.type === "final") {
      return {
        content: decision.content,
        query: lastQuery,
        source: lastSource,
      };
    }

    const toolResult = await executeMcpTool(decision.input);
    lastQuery = toolResult.query;
    lastSource = toolResult.source;

    messages.push({
      role: "user",
      content: [
        `Tool result for ${decision.input}:`,
        toolResult.content,
        "",
        "If this is enough, return a final answer as JSON.",
        "If you still need more information, request exactly one more tool as JSON.",
      ].join("\n"),
    });
  }

  return {
    content:
      "I could not finish the database reasoning flow within the tool-call limit. Please try a narrower question.",
    query: lastQuery,
    source: lastSource,
  };
}
