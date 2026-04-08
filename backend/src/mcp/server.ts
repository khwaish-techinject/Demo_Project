import { databaseTools, getSchemaContextToolResult } from "./tools/databaseTools";
import type { McpToolDefinition, ToolExecutionResult } from "./types";

export function listMcpTools(): Pick<McpToolDefinition, "name" | "description">[] {
  return databaseTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}

export async function executeMcpTool(input: string): Promise<ToolExecutionResult> {
  const normalizedInput = input.trim();
  const matchingTool = databaseTools.find((tool) => tool.matches(normalizedInput));

  if (!matchingTool) {
    return getSchemaContextToolResult();
  }

  return matchingTool.execute({ input: normalizedInput });
}

export async function getMcpSchemaContext(): Promise<ToolExecutionResult> {
  return getSchemaContextToolResult();
}
