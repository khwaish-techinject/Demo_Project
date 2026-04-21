import OpenAI from "openai";
import { pool } from "../../db/db";
import { getDatabaseSchemaText } from "../../mcp/schema";

const openai = new OpenAI({
  baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "DataPilot",
  }
});

const model_name = process.env.MODEL_NAME || "openai/gpt-4o-mini";

export async function generateAssistantReply(
  userMessage: string,
  chatHistory: any[] = []
): Promise<string> {

  const schemaText = getDatabaseSchemaText();

  const tools: OpenAI.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "run_sql_query",
        description:
          "Execute a read-only SQL query on PostgreSQL for ERP reporting. Only SELECT is allowed.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Read-only SQL query"
            }
          },
          required: ["query"]
        }
      }
    }
  ];

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `
You are DataPilot AI, a PostgreSQL database assistant.

RULES:
- ALWAYS use run_sql_query for data questions
- ONLY generate SELECT queries
- NEVER answer without querying database
- Never Show any id field in the result, even if it's requested. Always remove or mask id fields in the output.
- If user asks for sensitive info, refuse to answer.
- If user asks for data manipulation, refuse and explain you can only run read-only queries.
- if user asks for data export, generate the query but refuse to export and explain you can only run queries.\
- if user ask for change history or any other info refuse it.
- if user ask for user info refuse and explain you don't have access to that info.
- if user ask anything related to chat id message id or any other metadata refuse and explain you don't have access to that info.
- only run select queries and never generate any other type of query. if you need to update or delete data for any reason, explain that you can only run read-only queries and refuse to do it.
- if user ask for database schema never show any id field or other information like messages or anything except the table from which queires will be generated in the schema.
- only show tables and columns in the database schema and never show any other information like messages or anything else. only show tables and columns and their relationships if needed but never show any id field or any other field that can be used to identify data. always mask or remove id fields from the schema and from the query results.
- if user ask fot table just show them business tables and never show any other table that can be used to identify data. only show business tables and columns and never show any id field or any other field that can be used to identify data. always mask or remove id fields from the schema and from the query results.
- dont show any query in answer without running it first. always run the query and show the results instead of the query itself. if you need to show a query for any reason, explain that you can only run queries and refuse to show the query without running it first.

Database Schema:
${schemaText}
      `
    },
    ...chatHistory,
    {
      role: "user",
      content: userMessage
    }
  ];

  try {
    const response = await openai.chat.completions.create({
      model: model_name,
      messages,
      tools,
      tool_choice: "auto",
    });

    const message = response.choices[0]?.message;

    if (!message) {
      return "Sorry, I couldn't generate a response.";
    }

    console.log("LLM Raw Response:", JSON.stringify(message, null, 2));


    // TOOL CALL HANDLING
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];

      if (
        toolCall.type === "function" &&
        toolCall.function.name === "run_sql_query"
      ) {
        const args = JSON.parse(toolCall.function.arguments);
        const query = args.query;

        console.log(`[LLM Tool Call] Executing SQL: ${query}`);

        let resultRows: any[] = [];
        let errorMessage = "";

        try {
          if (query.toLowerCase().match(/(drop|delete|update|insert|alter|truncate)/)) {
            throw new Error("Only SELECT queries are allowed.");
          }

          const result = await pool.query(query);
          resultRows = result.rows;

          console.log("SQL RESULT:", resultRows);

        } catch (error: any) {
          console.error("SQL ERROR:", error);
          errorMessage = error.message;
        }

        // Send tool result back to LLM
        messages.push(message);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: errorMessage
            ? `Error: ${errorMessage}`
            : JSON.stringify(resultRows),
        });

        // Second LLM call (final answer)
        const secondResponse = await openai.chat.completions.create({
          model: model_name,
          messages,
        });

        const finalText =
          secondResponse.choices[0]?.message?.content ||
          "Sorry, no result.";

        // IMPORTANT: return ONLY TEXT (no JSON.stringify)
        //return finalText;
        return JSON.stringify({
          type: "query_result",
          text: finalText,
          data: resultRows
});
      }
    }

    // No tool call case
    return message.content || "Hello!";
  } catch (error) {
    console.error("Error calling OpenRouter:", error);
    return "I encountered an error while processing your request.";
  }
}