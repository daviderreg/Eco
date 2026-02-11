import { useEffect, useState, useCallback } from 'react';
import Tts from 'react-native-tts';

/**
 * Hook: useVoiceSetup
 * - Configura automaticamente la voce italiana migliore
 * - Imposta lingua, rate e pitch
 * - Fornisce funzioni di speak() e stop()
 * - Restituisce anche un flag isSpeaking
 */
export const useVoiceSetup = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);

  // Setup iniziale voce italiana
  const setupItalianVoice = useCallback(async () => {
    try {
      const voices = await Tts.voices();
      const italianVoices = voices.filter(v => v.language === 'it-IT');

      if (italianVoices.length === 0) {
        console.warn('⚠️ Nessuna voce italiana trovata.');
        return;
      }

      // Scegli la voce con qualità più alta
      const bestVoice = italianVoices.sort(
        (a, b) => (b.quality || 0) - (a.quality || 0)
      )[0];

      console.log('✅ Voce italiana selezionata:', bestVoice);

      await Tts.setDefaultLanguage('it-IT');
      await Tts.setDefaultVoice(bestVoice.id);
      await Tts.setDefaultRate(0.5);
      await Tts.setDefaultPitch(1.0);

      setVoiceReady(true);
    } catch (err) {
      console.error('Errore setup voce:', err);
    }
  }, []);

  // Esegui il setup al montaggio
  useEffect(() => {
    setupItalianVoice();
  }, [setupItalianVoice]);

  // Gestione eventi di stato parlato
  useEffect(() => {
    const startSub = Tts.addEventListener('tts-start', () => setIsSpeaking(true));
    const finishSub = Tts.addEventListener('tts-finish', () => setIsSpeaking(false));
    const cancelSub = Tts.addEventListener('tts-cancel', () => setIsSpeaking(false));

    return () => {
      startSub.remove();
      finishSub.remove();
      cancelSub.remove();
    };
  }, []);

  // Funzioni di controllo parlato
  const speak = useCallback((text: string) => {
    if (!text?.trim()) return;
    Tts.stop();
    Tts.speak(text);
  }, []);

  const stop = useCallback(() => {
    Tts.stop();
  }, []);

  return {
    isSpeaking,
    voiceReady,
    speak,
    stop,
  };
};
