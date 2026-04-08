export type ToolSource = "schema" | "query" | "tool";

export type ToolExecutionResult = {
  content: string;
  query: string;
  source: ToolSource;
};

export type ToolContext = {
  input: string;
};

export type McpToolDefinition = {
  name: string;
  description: string;
  matches: (input: string) => boolean;
  execute: (context: ToolContext) => Promise<ToolExecutionResult>;
};
