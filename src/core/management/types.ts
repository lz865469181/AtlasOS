export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export function success<T>(data: T): ApiResponse<T> {
  return { ok: true, data };
}

export function failure(error: string): ApiResponse {
  return { ok: false, error };
}
