'use client';
import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/presentation';
type Language = 'zh' | 'en';
const Context = createContext({
  enabled: false,
  language: 'zh' as Language,
  setLanguage: (_: Language) => {},
  label: (en: string, zh?: string) => zh || en,
});
const listeners = new Set<() => void>();
let currentLanguage: Language | undefined;
function readLanguage(): Language {
  if (currentLanguage) return currentLanguage;
  try {
    return localStorage.getItem('review-language') === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === 'review-language') {
      currentLanguage = undefined;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
/** Language is UI preference only. Never translate or rewrite saved project content. */
export function WorkbenchLanguageProvider({
  children,
}: {
  children: ReactNode;
}) {
  const language = useSyncExternalStore(
    subscribe,
    readLanguage,
    () => 'zh' as Language,
  );
  const change = (next: Language) => {
    currentLanguage = next;
    try {
      localStorage.setItem('review-language', next);
    } catch {}
    listeners.forEach((listener) => listener());
  };
  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  }, [language]);
  return (
    <Context.Provider
      value={{
        enabled: true,
        language,
        setLanguage: change,
        label: (en, zh) => (language === 'zh' && zh ? zh : en),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useWorkbenchLanguage = () => useContext(Context);
export function LanguageSwitch() {
  const { language, setLanguage } = useWorkbenchLanguage();
  return (
    <Surface variant="control-group" aria-label="Language">
      <Button
        size="sm"
        variant={language === 'zh' ? 'secondary' : 'ghost'}
        aria-pressed={language === 'zh'}
        onClick={() => setLanguage('zh')}
      >
        中文
      </Button>
      <Button
        size="sm"
        variant={language === 'en' ? 'secondary' : 'ghost'}
        aria-pressed={language === 'en'}
        onClick={() => setLanguage('en')}
      >
        English
      </Button>
    </Surface>
  );
}
