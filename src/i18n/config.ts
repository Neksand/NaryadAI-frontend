import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import ru from './ru';
import kk from './kk';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { ru: { translation: ru }, kk: { translation: kk } },
    fallbackLng: 'ru',
    supportedLngs: ['ru', 'kk'],
    detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'], lookupLocalStorage: 'naryadai.lang' },
    interpolation: { escapeValue: false },
  });

export default i18n;
