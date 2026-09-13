export type ChatGptSession = { enabled: boolean; connected: boolean; imageVerified: boolean };
export const disconnectedChatGpt: ChatGptSession = { enabled: false, connected: false, imageVerified: false };

export async function chatGptRequest(path: string, body?: object): Promise<any> {
  const response = await fetch(`/api/chatgpt/${path}`, {
    credentials: 'same-origin',
    ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(response.status === 401 ? 'Подключите ChatGPT заново.' : response.status === 429 ? 'Слишком много запросов. Попробуйте позже.' : 'Не удалось выполнить запрос. Попробуйте снова.');
  return response.json();
}

let completion: Promise<void> | undefined;
/** One exchange even under React StrictMode; no token or verifier in the browser. */
export function completeChatGptLogin(): Promise<void> {
  if (completion) return completion;
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  window.history.replaceState(null, '', '/chatgpt/callback');
  completion = code && state && !url.searchParams.has('error')
    ? chatGptRequest('callback', { code, state }).then(() => {})
    : Promise.reject(new Error('Вход отменён или ссылка недействительна. Начните подключение из Cover.'));
  return completion;
}
