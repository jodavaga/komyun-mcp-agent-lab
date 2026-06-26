import { createInterface } from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import { addAssistantMessage, addUserMessage, chat, textFromMessage } from "./anthropic";
import { McpClient } from "./mcpClient";

function logResponseBlocks(response: Anthropic.Message): void {
    for (const block of response.content) {
        if (block.type === "text") {
            console.log("[assistant text]", block.text);
        } else if (block.type === "tool_use") {
            console.log("[tool_use]", block.name, JSON.stringify(block.input));
        }
    }
}

export async function runAgentTurn(
    messages: Anthropic.MessageParam[],
    mcpClient: McpClient
): Promise<Anthropic.Message> {
    let response = await chat(messages, { tools: mcpClient.getAnthropicTools() });
    addAssistantMessage(messages, response);
    logResponseBlocks(response);

    while (response.stop_reason === "tool_use") {
        const toolUseBlocks = response.content.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
        );

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolUseBlocks) {
            const { content, isError } = await mcpClient.callTool(block.name, block.input);
            console.log("[tool_result]", block.name, "->", JSON.stringify(content));
            toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content,
                is_error: isError,
            });
        }

        addUserMessage(messages, toolResults);
        response = await chat(messages, { tools: mcpClient.getAnthropicTools() });
        addAssistantMessage(messages, response);
        logResponseBlocks(response);
    }

    return response;
}

export async function runChatRepl(mcpClient: McpClient): Promise<void> {
    const messages: Anthropic.MessageParam[] = [];
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    while (true) {
        let userInput: string;
        try {
            userInput = await rl.question("> ");
        } catch {
            break; // stdin closed (EOF / Ctrl+D) — end the session
        }

        addUserMessage(messages, userInput);
        const answer = await runAgentTurn(messages, mcpClient);

        console.log("---");
        console.log(textFromMessage(answer));
        console.log("---");
    }

    rl.close();
}
