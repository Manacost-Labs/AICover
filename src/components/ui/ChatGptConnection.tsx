import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import { ModelPicker, type ModelOption } from './ModelPicker';
import { Button } from './Controls';
import { chatGptRequest, completeChatGptLogin, disconnectedChatGpt, type ChatGptSession } from '../../services/chatgptSession';
import '../../styles/chatgpt.css';
import openaiLogo from '../../assets/model-logos/openai.svg';
import metaLogo from '../../assets/model-logos/meta.svg';
import recraftLogo from '../../assets/model-logos/recraft.svg';
import bytedanceLogo from '../../assets/model-logos/bytedance.svg';
import xaiLogo from '../../assets/model-logos/xai.svg';
import qwenLogo from '../../assets/model-logos/qwen.svg';
import kreaLogo from '../../assets/model-logos/krea.svg';
import sourcefulLogo from '../../assets/model-logos/sourceful.png';
import {
  OPENROUTER_IMAGE_MODELS,
  getOpenRouterModel,
  loadOpenRouterModelAvailability,
  type OpenRouterModelAvailabilityMap,
} from '../../services/openRouterImages';

const openRouterModelLogos: Record<string, string> = {
  'openai/gpt-image-2': openaiLogo,
  'meta/muse-image': metaLogo,
  'recraft/recraft-v4-styles-pro': recraftLogo,
  'bytedance-seed/seedream-5-0-lite': bytedanceLogo,
  'bytedance-seed/seedream-5-0-pro': bytedanceLogo,
  'x-ai/grok-imagine-image-2.0': xaiLogo,
  'qwen/qwen-image-3-pro': qwenLogo,
  'krea/krea-2-large': kreaLogo,
  'sourceful/riverflow-v2.5-pro': sourcefulLogo,
  'sourceful/riverflow-v2.5-fast': sourcefulLogo,
};

const idle = { ...disconnectedChatGpt, checking: false, refresh: async () => {} };
const SessionContext = createContext(idle);
const OpenRouterAvailabilityContext = createContext<OpenRouterModelAvailabilityMap>({});
export const useChatGpt = () => useContext(SessionContext);
export const useOpenRouterModelAvailability = () => useContext(OpenRouterAvailabilityContext);

export function ChatGptProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<ChatGptSession>(disconnectedChatGpt);
  const [checking, setChecking] = useState(true);
  const [openRouterAvailability, setOpenRouterAvailability] = useState<OpenRouterModelAvailabilityMap>({});
  const inflight = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (inflight.current) return inflight.current;
    inflight.current = chatGptRequest('session').then(value => {
      setSession({ enabled: value.enabled === true, connected: value.connected === true, imageVerified: value.imageVerified === true });
    }).catch(() => setSession(disconnectedChatGpt)).finally(() => { setChecking(false); inflight.current = null; });
    return inflight.current;
  }, []);
  useEffect(() => {
    void refresh();
    let availabilityActive = true;
    void loadOpenRouterModelAvailability()
      .then(value => { if (availabilityActive) setOpenRouterAvailability(value); })
      .catch(() => {});
    const message = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.type === 'cover:chatgpt-connected') void refresh();
    };
    const focus = () => { void refresh(); };
    window.addEventListener('message', message);
    window.addEventListener('focus', focus);
    window.addEventListener('cover:chatgpt-refresh', focus);
    return () => {
      availabilityActive = false;
      window.removeEventListener('message', message);
      window.removeEventListener('focus', focus);
      window.removeEventListener('cover:chatgpt-refresh', focus);
    };
  }, [refresh]);
  return <SessionContext.Provider value={{ ...session, checking, refresh }}>
    <OpenRouterAvailabilityContext.Provider value={openRouterAvailability}>
      {children}
    </OpenRouterAvailabilityContext.Provider>
  </SessionContext.Provider>;
}

export function ChatGptCallback() {
  const [status, setStatus] = useState('Завершаем подключение ChatGPT…');
  useEffect(() => {
    let active = true;
    completeChatGptLogin().then(() => {
      if (!active) return;
      setStatus('ChatGPT подключён. Можно вернуться в Cover.');
      window.opener?.postMessage({ type: 'cover:chatgpt-connected' }, window.location.origin);
      if (window.opener) window.close();
    }).catch(error => { if (active) setStatus(error.message); });
    return () => { active = false; };
  }, []);
  return <main className="chatgpt-callback"><h1>Подключение ChatGPT</h1><p role="status">{status}</p><a href="/">Вернуться в Cover</a></main>;
}

export function ChatGptConnection({ disabled = false }: { disabled?: boolean }) {
  const session = useChatGpt();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [models, setModels] = useState<string[] | null>(null);
  useEffect(() => { if (!session.connected) setModels(null); }, [session.connected]);
  if (!session.enabled) return null;
  async function action(kind: 'login' | 'disconnect' | 'models') {
    // Open synchronously from the click so the user's current editor stays intact.
    const popup = kind === 'login' ? window.open('about:blank', 'cover-chatgpt-login', 'popup,width=560,height=760') : null;
    if (kind === 'login' && !popup) { setError('Разрешите всплывающее окно для подключения ChatGPT.'); return; }
    setBusy(true); setError('');
    try {
      const value = await chatGptRequest(kind, {});
      if (kind === 'login') {
        const url = new URL(value.authorizationUrl);
        if (url.origin !== 'https://auth.openai.com' || url.pathname !== '/oauth/authorize') throw new Error('Некорректная ссылка входа.');
        popup!.location.href = url.href;
      } else if (kind === 'models') {
        setModels(Array.isArray(value.models) ? value.models.filter((model: any) => typeof model.id === 'string').map((model: any) => model.id) : []);
      }
      await session.refresh();
    } catch (cause) { popup?.close(); setError(cause instanceof Error ? cause.message : 'Не удалось подключить ChatGPT.'); }
    finally { setBusy(false); }
  }
  return <section className="chatgpt-connection" aria-label="Личный аккаунт ChatGPT">
    <div className="chatgpt-connection__status"><span>{session.connected ? <Check size={15} /> : <Link2 size={15} />}<strong>{session.connected ? 'ChatGPT подключён' : 'Ваш аккаунт ChatGPT'}</strong></span>
      <Button variant="ghost" disabled={disabled || busy || session.checking} onClick={() => void action(session.connected ? 'disconnect' : 'login')}>{busy ? 'Подождите…' : session.connected ? 'Отключить' : 'Подключить'}</Button>
    </div>
    <p>{session.connected ? session.imageVerified ? 'Генерация GPT Image 2 проверена в этой сессии.' : 'Доступ к GPT Image 2 проверится при первой генерации. Действуют лимиты вашей подписки.' : 'Для GPT Image 2 подключите свой ChatGPT. Другие пользователи не используют ваш аккаунт.'}</p>
    {!session.connected && <details><summary>Как подключиться</summary><p>Установите расширение Sign in with ChatGPT для <a href="https://chromewebstore.google.com/detail/sign-in-with-chatgpt/odbgboachaefbbbdiffcefhpkekhfcna" target="_blank" rel="noreferrer">Chrome</a> или <a href="https://addons.mozilla.org/firefox/addon/sign-in-with-chatgpt/" target="_blank" rel="noreferrer">Firefox</a>, затем нажмите «Подключить». Safari не поддерживается. Это неофициальная интеграция; расширение попросит подтвердить адрес Cover.</p><p>Подключение сохраняется после перезапуска Cover и действует до 8 часов. На общем устройстве нажимайте «Отключить» после работы.</p></details>}
    {session.connected && <details><summary>Другие модели изображений</summary><p>Проверим каталог вашего аккаунта без запуска генерации. Новые названия не означают, что модель уже поддерживается.</p><Button variant="ghost" disabled={disabled || busy} onClick={() => void action('models')}>Проверить каталог</Button>{models !== null && <p role="status">{models.length ? `Каталог вернул: ${models.join(', ')}. В Cover подключён только GPT Image 2.` : 'Каталог не вернул image-моделей. Проверка GPT Image 2 возможна только запросом генерации.'}</p>}</details>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function ProviderModelPicker({
  openRouterEnabled = false,
  ...props
}: React.ComponentProps<typeof ModelPicker> & { openRouterEnabled?: boolean }) {
  const session = useChatGpt();
  const availability = useOpenRouterModelAvailability();
  const chatGpt: ModelOption = { id: 'gpt-image-2', name: 'GPT Image 2', providerName: 'ChatGPT', logoSrc: openaiLogo, description: 'Генерация и редактирование через ваш ChatGPT', disabled: !session.connected || session.checking, disabledReason: session.connected ? undefined : 'Сначала подключите свой аккаунт ChatGPT.' };
  const openRouter: ModelOption[] = OPENROUTER_IMAGE_MODELS.map(model => ({
    id: model.id,
    name: model.name,
    providerName: model.providerName,
    logoSrc: openRouterModelLogos[model.id],
    description: model.description,
    disabled: !model.coverCompatible || availability[model.id] === 'unavailable',
    disabledReason: availability[model.id] === 'unavailable'
      ? 'У модели сейчас нет активного endpoint OpenRouter. Выберите другую модель.'
      : undefined,
  }));
  const options = [
    ...props.options,
    ...(session.enabled ? [chatGpt] : []),
    ...(openRouterEnabled ? openRouter : []),
  ];
  return <><ModelPicker {...props} options={options} /><ChatGptConnection disabled={props.disabled} /></>;
}

export function ChatGptImageNotice() {
  return <p className="chatgpt-image-notice">Размер выбирается автоматически. Формат передаётся как пожелание, точные пропорции не гарантируются. До 5 исходников, по 10 МБ и до 24 МБ суммарно; избранные примеры используются только при наличии свободных мест. Автопроверка Gemini отключена.</p>;
}

export function OpenRouterImageNotice({ modelId }: { modelId: string }) {
  const model = getOpenRouterModel(modelId);
  if (!model) return null;
  if (model.referenceStrategy === 'contact-sheet') {
    const limitMiB = Math.floor(model.maxReferenceBytes / 1024 / 1024);
    return <p className="chatgpt-image-notice">OpenRouter · все исходники объединяются без обрезки в один подписанный лист до {limitMiB} МиБ. {model.id === 'meta/muse-image' ? 'Запуск Muse зависит от активного endpoint OpenRouter. ' : ''}Автопроверка Gemini отключена.</p>;
  }
  return <p className="chatgpt-image-notice">OpenRouter · до {model.maxReferences} референсов для этой модели, по 10 МиБ и до 24 МиБ суммарно. Параметры формата приводятся к возможностям модели. Автопроверка Gemini отключена.</p>;
}
