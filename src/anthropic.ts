import 'dotenv/config';
import Anthropic from "@anthropic-ai/sdk";
import { Message, MessageCreateParamsNonStreaming, Tool } from '@anthropic-ai/sdk/resources';

export const client = new Anthropic();

export const addUserMessage = (
    messages: Anthropic.MessageParam[],
    content: Anthropic.MessageParam["content"]
) => {
    messages.push({ role: "user", content });
    return messages;
};

export const addAssistantMessage = (
    messages: Anthropic.MessageParam[],
    response: Anthropic.Message
) => {
    messages.push({ role: "assistant", content: response.content });
    return messages;
};

export type ChatOptions = {
    system?: string;
    temperature?: number;
    stop_sequences?: string[];
    tools?: Tool[];
    thinking?: boolean;
    thinking_budget?: number;
};

export const chat = async (
    messages: Anthropic.MessageParam[],
    options: ChatOptions = {}
): Promise<Message> => {
    const {
        system,
        temperature = 1.0,
        stop_sequences,
        tools,
        thinking = false,
        thinking_budget = 1024,
    } = options;

    const params: MessageCreateParamsNonStreaming = {
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 4000,
        messages,
        temperature,
        stop_sequences,
    };

    if (system) params.system = system;

    if (tools) params.tools = tools;

    if (thinking) {
        params.thinking = { type: "enabled", budget_tokens: thinking_budget };
    }

    return client.messages.create(params);
};

export const textFromMessage = (message: Message): string => {
    return message.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n");
};
