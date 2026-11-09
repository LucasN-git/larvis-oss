// Minimal request/response types of the API handlers — just the members we use.
// server/index.mjs extends Node's request/response objects with exactly these
// members (query, body, status, json, send, redirect).
export interface ApiRequest {
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  body?: unknown;
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  send(body: string): void;
  redirect(url: string): void;
  setHeader(name: string, value: string): void;
}
