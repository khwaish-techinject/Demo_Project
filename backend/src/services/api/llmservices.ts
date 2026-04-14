// import OpenAI from "openai";
// import { pool } from "../../db/db";
// import { getDatabaseSchemaText } from "../../mcp/schema";

// const openai = new OpenAI({
//   baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
//   apiKey: process.env.OPENROUTER_API_KEY,
//   defaultHeaders: {
//     "HTTP-Referer": "http://localhost:3000",
//     "X-Title": "DataPilot",
//   }
// });

// const model_name = process.env.MODEL_NAME || "openai/gpt-4o-mini";

// export async function generateAssistantReply(userMessage: string, chatHistory: any[] = []): Promise<string> {
//   const schemaText = getDatabaseSchemaText();

//   const tools: OpenAI.ChatCompletionTool[] = [
//     {
//       type: "function",
//       function: {
//         name: "run_sql_query",
//         description: "Execute a read-only SQL query on PostgreSQL for ERP reporting. Only SELECT is allowed. The database schema is provided in the system prompt.",
//         parameters: {
//           type: "object",
//           properties: {
//             query: {
//               type: "string",
//               description: "Read-only SQL query to execute (e.g. SELECT * FROM customers)"
//             }
//           },
//           required: ["query"]
//         }
//       }
//     }
//   ];

//   const messages: OpenAI.ChatCompletionMessageParam[] = [
//     {
//       role: "system",
//       content: `
//         You are DataPilot AI, a PostgreSQL database assistant.

//         IMPORTANT RULES:
//             - ALWAYS use the run_sql_query tool to answer questions related to data.
//             - NEVER answer from your own knowledge.
//             - ALWAYS generate a SQL SELECT query.
//             - The database schema is provided below.

//             Steps:
//             1. Understand the user question
//             2. Generate a SQL query
//             3. Call run_sql_query
//             4. Use the result to generate final answer

//             Database Schema:
//             ${schemaText}
//             `
//     },
//     ...chatHistory,
//     {
//       role: "user",
//       content: userMessage
//     }
//   ];

//   try {
//     let response = await openai.chat.completions.create({
//       model: model_name,
//       messages: messages,
//       tools: tools,
//       tool_choice: "auto",
//     });

//     let message = response.choices[0]?.message;

//     if (!message) {
//       return "Sorry, I couldn't generate a response.";
//     }
//     console.log("LLM Raw Response:", JSON.stringify(message, null, 2));
//     if (message.tool_calls && message.tool_calls.length > 0) {
//       // Execute the tool call
//       const toolCall = message.tool_calls[0];
//       if (toolCall.type === "function" && toolCall.function.name === "run_sql_query") {
//         const args = JSON.parse(toolCall.function.arguments);
//         const query = args.query;
        
//         console.log(`[LLM Tool Call] Executing SQL: ${query}`);
//         let finalOutput = "";
//         try {
//           if (query.toLowerCase().match(/(drop|delete|update|insert|alter|truncate)/)) {
//             throw new Error("Only SELECT queries are allowed.");
//           }
//           const result = await pool.query(query);
//           finalOutput = JSON.stringify(result.rows);
//         } catch (error: any) {
//           finalOutput = `Error executing query: ${error.message}`;
//         }
        
//         messages.push(message);
//         messages.push({
//           role: "tool",
//           tool_call_id: toolCall.id,
//           content: finalOutput
//         });

//         // Get the final response from the LLM
//         const secondResponse = await openai.chat.completions.create({
//            model: model_name,
//            messages: messages,
//         });
//         const finalText = secondResponse.choices[0]?.message?.content || "Sorry, no result.";

//         return JSON.stringify({
//             type: "query_result",
//             text: finalText,
//             data: JSON.parse(finalOutput)

//         });
//         //return secondResponse.choices[0]?.message?.content || "Sorry, no result.";
//       }
//     }

//     return message.content || "Hello!";
//   } 
//   catch (error) {
//     console.error("Error calling OpenRouter:", error);
//     return "I encountered an error while trying to process your request.";
//   }
// }
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