import { describe, it, expect, afterEach } from 'bun:test';
import { LANGUAGES, detectLanguage, setLanguage, t, type MessageKey } from './i18n';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  afterEach(() => setLanguage('en'));

  it('should keep the same placeholders as English in every language', () => {
    const en = LANGUAGES.en as Record<string, string>;
    for (const [lang, dict] of Object.entries(LANGUAGES)) {
      for (const [key, text] of Object.entries(dict as Record<string, string>)) {
        expect(key in en, `${lang}: unknown key ${key}`).toBe(true);
        expect(placeholders(text), `${lang}.${key}`).toEqual(placeholders(en[key]!));
      }
    }
  });

  it('should translate most messages in every language', () => {
    const total = Object.keys(LANGUAGES.en).length;
    for (const [lang, dict] of Object.entries(LANGUAGES)) {
      expect(Object.keys(dict).length / total, lang).toBeGreaterThan(0.9);
    }
  });

  it('should fill in placeholders and fall back to English', () => {
    setLanguage('ro');
    expect(t('alreadyInstalled', { version: '4.10.3112.0' })).toBe('Widevine 4.10.3112.0 este deja instalat');
    setLanguage('de');
    expect(t('guiTitle')).toBe('Helium DRM Fixer'); // not translated -> English
  });

  it('should pick the language from an explicit choice or the environment', () => {
    expect(detectLanguage('ro-RO')).toBe('ro');
    expect(detectLanguage('pt_BR.UTF-8')).toBe('pt');
    const saved = process.env.HELIUM_DRM_FIXER_LANG;
    process.env.HELIUM_DRM_FIXER_LANG = 'it';
    expect(detectLanguage()).toBe('it');
    if (saved === undefined) delete process.env.HELIUM_DRM_FIXER_LANG;
    else process.env.HELIUM_DRM_FIXER_LANG = saved;
  });

  it('should have every key as a real message', () => {
    for (const key of Object.keys(LANGUAGES.en) as MessageKey[]) {
      expect(t(key).length, key).toBeGreaterThan(0);
    }
  });
});
