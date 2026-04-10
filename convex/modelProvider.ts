"use node";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = "gemini-2.5-flash";
const DIGITALOCEAN_INFERENCE_URL =
  "https://inference.do-ai.run/v1/chat/completions";
const DIGITALOCEAN_PRIMARY_DEFAULT_MODEL = "deepseek-r1-distill-llama-70b";
const DIGITALOCEAN_SECONDARY_DEFAULT_MODEL = "alibaba-qwen3-32b";

export type ModelMessage = {
  role: "system" | "user";
  content: string;
};

export type ModelAttemptTrace = {
  provider: string;
  model: string;
  attemptOrder: number;
  status: "success" | "failed";
  errorSummary?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
};

export type ModelRunTrace = {
  finalProvider: string;
  finalModel: string;
  fallbackDepth: number;
  attempts: ModelAttemptTrace[];
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
};

export type ModelCallResult = {
  content: string;
  trace: ModelRunTrace;
};

type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

type ProviderCallResult = {
  content: string;
  usage?: ModelUsage;
};

const DIGITALOCEAN_MODEL_PRICING_USD_PER_TOKEN = {
  "deepseek-r1-distill-llama-70b": {
    input: 0.99 / 1_000_000,
    output: 0.99 / 1_000_000,
  },
  "alibaba-qwen3-32b": {
    input: 0.25 / 1_000_000,
    output: 0.55 / 1_000_000,
  },
  "qwen3-32b": {
    input: 0.25 / 1_000_000,
    output: 0.55 / 1_000_000,
  },
} as const;

function resolveDigitalOceanPricing(model: string) {
  const normalizedModel = model.trim().toLowerCase();
  const direct =
    DIGITALOCEAN_MODEL_PRICING_USD_PER_TOKEN[
      normalizedModel as keyof typeof DIGITALOCEAN_MODEL_PRICING_USD_PER_TOKEN
    ];
  if (direct) {
    return direct;
  }

  if (normalizedModel.includes("deepseek-r1-distill-llama-70b")) {
    return DIGITALOCEAN_MODEL_PRICING_USD_PER_TOKEN[
      "deepseek-r1-distill-llama-70b"
    ];
  }

  if (normalizedModel.includes("qwen3-32b")) {
    return DIGITALOCEAN_MODEL_PRICING_USD_PER_TOKEN["qwen3-32b"];
  }

  return null;
}

function roundUsd(value: number) {
  return Number(value.toFixed(10));
}

function buildDigitalOceanUsage(args: {
  model: string;
  promptTokens: number;
  completionTokens: number;
}) {
  const pricing = resolveDigitalOceanPricing(args.model);
  if (!pricing) {
    return null;
  }

  return {
    inputTokens: args.promptTokens,
    outputTokens: args.completionTokens,
    estimatedCostUsd: roundUsd(
      args.promptTokens * pricing.input +
        args.completionTokens * pricing.output,
    ),
  } satisfies ModelUsage;
}

function buildDigitalOceanMessages(
  messages: ModelMessage[],
  responseFormat?: "json_object",
) {
  if (responseFormat !== "json_object") {
    return messages;
  }

  return [
    {
      role: "system" as const,
      content:
        "Return only a valid JSON object. Do not use markdown fences. Do not add explanation outside the JSON object.",
    },
    ...messages,
  ];
}

function composeGeminiInput(messages: ModelMessage[]) {
  const systemPrompt = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n")
    .trim();
  const userPrompt = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n\n")
    .trim();

  return {
    systemPrompt,
    userPrompt,
  };
}

async function callGemini(
  messages: ModelMessage[],
  args: {
    responseMimeType?: "application/json" | "text/plain";
    temperature: number;
    errorLabel: string;
  },
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(`Missing GEMINI_API_KEY for ${args.errorLabel}`);
  }

  const { systemPrompt, userPrompt } = composeGeminiInput(messages);
  const response = await fetch(
    `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(systemPrompt
          ? {
              systemInstruction: {
                parts: [{ text: systemPrompt }],
              },
            }
          : {}),
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: args.temperature,
          ...(args.responseMimeType
            ? { responseMimeType: args.responseMimeType }
            : {}),
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Gemini request failed (${response.status}): ${body.slice(0, 400)}`,
    );
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const content = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!content) {
    throw new Error("Gemini response did not include message content");
  }

  return {
    content,
  } satisfies ProviderCallResult;
}

async function callDigitalOceanChatCompletion(
  messages: ModelMessage[],
  args: {
    temperature: number;
    responseFormat?: "json_object";
    errorLabel: string;
    model?: string;
  },
) {
  const apiKey =
    process.env.DIGITALOCEAN_MODEL_ACCESS_KEY ??
    process.env.DO_MODEL_ACCESS_KEY ??
    process.env.DIGITALOCEAN_INFERENCE_KEY;
  if (!apiKey) {
    throw new Error(
      `Missing DIGITALOCEAN_MODEL_ACCESS_KEY for ${args.errorLabel}`,
    );
  }

  const model = args.model?.trim();
  if (!model) {
    throw new Error(`Missing DigitalOcean model for ${args.errorLabel}`);
  }
  const baseUrl =
    process.env.DIGITALOCEAN_INFERENCE_BASE_URL ??
    process.env.DO_INFERENCE_BASE_URL ??
    DIGITALOCEAN_INFERENCE_URL;

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: args.temperature,
      messages: buildDigitalOceanMessages(messages, args.responseFormat),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `DigitalOcean inference request failed (${response.status}): ${body.slice(0, 400)}`,
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
  };

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(
      "DigitalOcean inference response did not include message content",
    );
  }

  const promptTokens =
    payload.usage?.prompt_tokens ?? payload.usage?.input_tokens;
  const completionTokens =
    payload.usage?.completion_tokens ?? payload.usage?.output_tokens;
  const usage =
    typeof promptTokens === "number" && typeof completionTokens === "number"
      ? (buildDigitalOceanUsage({
          model,
          promptTokens,
          completionTokens,
        }) ?? undefined)
      : undefined;

  return {
    content,
    usage,
  } satisfies ProviderCallResult;
}

function getDigitalOceanPrimaryModel() {
  return (
    process.env.DIGITALOCEAN_PRIMARY_INFERENCE_MODEL ??
    process.env.DO_PRIMARY_INFERENCE_MODEL ??
    process.env.DIGITALOCEAN_INFERENCE_MODEL ??
    process.env.DO_INFERENCE_MODEL ??
    DIGITALOCEAN_PRIMARY_DEFAULT_MODEL
  );
}

function getDigitalOceanSecondaryModel() {
  return (
    process.env.DIGITALOCEAN_SECONDARY_INFERENCE_MODEL ??
    process.env.DO_SECONDARY_INFERENCE_MODEL ??
    DIGITALOCEAN_SECONDARY_DEFAULT_MODEL
  );
}

async function callGroqChatCompletion(
  messages: ModelMessage[],
  args: {
    temperature: number;
    responseFormat?: "json_object";
    errorLabel: string;
  },
) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(`Missing GROQ_API_KEY for ${args.errorLabel}`);
  }

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: args.temperature,
      ...(args.responseFormat
        ? { response_format: { type: args.responseFormat } }
        : {}),
      messages,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Groq request failed (${response.status}): ${body.slice(0, 400)}`,
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Groq response did not include message content");
  }

  return {
    content,
  } satisfies ProviderCallResult;
}

type ProviderAttempt = {
  label: string;
  provider: string;
  model: string;
  call: () => Promise<ProviderCallResult>;
};

async function runProviderChain(
  attempts: ProviderAttempt[],
  args: { errorLabel: string },
) {
  let lastError: unknown = null;
  const traceAttempts: ModelAttemptTrace[] = [];

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    if (!attempt) {
      continue;
    }

    try {
      const result = await attempt.call();
      traceAttempts.push({
        provider: attempt.provider,
        model: attempt.model,
        attemptOrder: index + 1,
        status: "success",
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        estimatedCostUsd: result.usage?.estimatedCostUsd,
      });
      return {
        content: result.content,
        trace: {
          finalProvider: attempt.provider,
          finalModel: attempt.model,
          fallbackDepth: index,
          attempts: traceAttempts,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          estimatedCostUsd: result.usage?.estimatedCostUsd,
        },
      };
    } catch (error) {
      lastError = error;
      traceAttempts.push({
        provider: attempt.provider,
        model: attempt.model,
        attemptOrder: index + 1,
        status: "failed",
        errorSummary:
          error instanceof Error
            ? error.message.slice(0, 400)
            : String(error).slice(0, 400),
      });
      const nextAttempt = attempts[index + 1];
      if (nextAttempt) {
        console.warn(
          `${attempt.label} call failed, falling back to ${nextAttempt.label}`,
          error,
        );
      }
    }
  }

  throw new Error(
    `${args.errorLabel} failed across all providers${
      lastError instanceof Error ? `: ${lastError.message}` : ""
    }`,
  );
}

export async function callModelJsonWithFallback(
  messages: ModelMessage[],
  args: {
    errorLabel: string;
  },
) {
  const result = await callModelJsonWithFallbackTrace(messages, args);
  return result.content;
}

export async function callModelJsonWithFallbackTrace(
  messages: ModelMessage[],
  args: {
    errorLabel: string;
  },
) {
  const primaryDoModel = getDigitalOceanPrimaryModel();
  const secondaryDoModel = getDigitalOceanSecondaryModel();

  return await runProviderChain(
    [
      {
        label: "Gemini",
        provider: "gemini",
        model: GEMINI_MODEL,
        call: () =>
          callGemini(messages, {
            responseMimeType: "application/json",
            temperature: 0.2,
            errorLabel: args.errorLabel,
          }),
      },
      {
        label: `DigitalOcean (${primaryDoModel})`,
        provider: "digitalocean",
        model: primaryDoModel,
        call: () =>
          callDigitalOceanChatCompletion(messages, {
            temperature: 0.2,
            responseFormat: "json_object",
            errorLabel: args.errorLabel,
            model: primaryDoModel,
          }),
      },
      {
        label: `DigitalOcean (${secondaryDoModel})`,
        provider: "digitalocean",
        model: secondaryDoModel,
        call: () =>
          callDigitalOceanChatCompletion(messages, {
            temperature: 0.2,
            responseFormat: "json_object",
            errorLabel: args.errorLabel,
            model: secondaryDoModel,
          }),
      },
      {
        label: "Groq",
        provider: "groq",
        model: GROQ_MODEL,
        call: () =>
          callGroqChatCompletion(messages, {
            temperature: 0.2,
            responseFormat: "json_object",
            errorLabel: args.errorLabel,
          }),
      },
    ],
    args,
  );
}

export async function callModelTextWithFallback(
  messages: ModelMessage[],
  args: {
    temperature: number;
    errorLabel: string;
  },
) {
  const result = await callModelTextWithFallbackTrace(messages, args);
  return result.content;
}

export async function callModelTextWithFallbackTrace(
  messages: ModelMessage[],
  args: {
    temperature: number;
    errorLabel: string;
  },
) {
  const primaryDoModel = getDigitalOceanPrimaryModel();
  const secondaryDoModel = getDigitalOceanSecondaryModel();

  return await runProviderChain(
    [
      {
        label: "Gemini",
        provider: "gemini",
        model: GEMINI_MODEL,
        call: () =>
          callGemini(messages, {
            responseMimeType: "text/plain",
            temperature: args.temperature,
            errorLabel: args.errorLabel,
          }),
      },
      {
        label: `DigitalOcean (${primaryDoModel})`,
        provider: "digitalocean",
        model: primaryDoModel,
        call: () =>
          callDigitalOceanChatCompletion(messages, {
            temperature: args.temperature,
            errorLabel: args.errorLabel,
            model: primaryDoModel,
          }),
      },
      {
        label: `DigitalOcean (${secondaryDoModel})`,
        provider: "digitalocean",
        model: secondaryDoModel,
        call: () =>
          callDigitalOceanChatCompletion(messages, {
            temperature: args.temperature,
            errorLabel: args.errorLabel,
            model: secondaryDoModel,
          }),
      },
      {
        label: "Groq",
        provider: "groq",
        model: GROQ_MODEL,
        call: () =>
          callGroqChatCompletion(messages, {
            temperature: args.temperature,
            errorLabel: args.errorLabel,
          }),
      },
    ],
    args,
  );
}
