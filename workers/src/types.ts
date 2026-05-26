export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderResponse {
  response: Response;
  provider: string;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface UserContext {
  userId: string;
  plan: "free" | "pro";
  email?: string;
}

export interface Env {
  RATE_LIMIT_KV: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_JWT_SECRET: string;
  SUPABASE_SERVICE_KEY: string;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  GEMINI_API_KEY: string;
  DEEPSEEK_API_KEY: string;
  GROQ_API_KEY: string;
  ALLOWED_ORIGINS: string;
}

export interface ModelConfig {
  provider: "openai" | "anthropic" | "gemini" | "deepseek" | "groq";
  model: string;
  fallbackProvider: "openai" | "anthropic" | "gemini" | "deepseek" | "groq";
  fallbackModel: string;
  costPer1kIn: number;
  costPer1kOut: number;
}
