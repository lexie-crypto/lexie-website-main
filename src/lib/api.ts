// API configuration - using proxy endpoints for security
export const API_ENDPOINTS = {
  chat: '/api/chat',      // Proxied chat endpoint with server-side HMAC auth
};

// API response types
export interface ChatResponse {
  message: string;
  action?: string;
}

export interface ApiError {
  error: string;
  details?: string;
}

// Chat API service using secure proxy endpoints
export class ChatService {
  static async sendMessage(message: string, options?: { funMode?: boolean }): Promise<ChatResponse> {
    try {
      const apiUrl = API_ENDPOINTS.chat;
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      const body = JSON.stringify({
        message,
        ...(options || {}),
        // Provide explicit personality mode for the proxy/backend
        personalityMode: options?.funMode ? 'degen' : 'normal',
      });

      console.log(`[ChatService] Sending message to proxy endpoint:`, {
        url: apiUrl,
        method: 'POST',
        messageLength: message.length,
        funMode: options?.funMode,
      });

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body,
        // Align with proxy/server timeout to avoid premature client aborts
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error(`[ChatService] API error:`, {
          status: response.status,
          statusText: response.statusText,
          errorData
        });
        throw new Error(`${errorData.error || `HTTP ${response.status}: ${response.statusText}`}`);
      }

      const data = await response.json();
      console.log(`[ChatService] Success response:`, {
        messageLength: data.message?.length || 0,
        hasAction: !!data.action
      });

      return data as ChatResponse;
    } catch (error) {
      console.error(`Chat API error:`, error);
      if (error instanceof Error) {
        if (error.name === 'TimeoutError') {
          throw new Error(`Request timeout - the API took too long to respond`);
        }
      }
      throw error;
    }
  }
}
