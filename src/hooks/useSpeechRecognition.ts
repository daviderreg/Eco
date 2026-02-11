import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {Platform} from 'react-native';
import {AndroidVolumeTypes, VolumeManager} from 'react-native-volume-manager';
import {SpeechRecContext} from '../context/SpeechRecProvider';
import {SpeechRecReqType} from '../context/SpeechRecTypes';
import * as RNLocalize from 'react-native-localize';
import RNFS from 'react-native-fs';

export interface SpeechRecognitionHookType {
  // Actions
  startSpeechRecognition: (languageCode?: string) => void;
  stopSpeechRecognition: () => void;
  cancelSpeechRecognition: () => void;

  // State
  speechContentRealTime: string;

  // Handlers
  setSpeechRecErrorHandler: (handler: (errorMessage: string) => void) => void;
  setSpeechRecStartedHandler: (handler: () => void) => void;
  setSpeechRecCompletedHandler: (
    handler: (speechRecResult: string) => void,
  ) => void;
}

const SPEECH_HISTORY_FILE = `${RNFS.DocumentDirectoryPath}/speechHistory.json`;

// 🔹 Funzione helper per salvare su file JSON
const saveTranscriptToFile = async (text: string) => {
  try {
    let history: string[] = [];

    // Se il file esiste, leggi il contenuto
    if (await RNFS.exists(SPEECH_HISTORY_FILE)) {
      const content = await RNFS.readFile(SPEECH_HISTORY_FILE, 'utf8');
      history = JSON.parse(content);
    }

    // Aggiungi nuovo testo con timestamp
    history.push(`${new Date().toISOString()} - ${text}`);

    // Scrivi su file
    await RNFS.writeFile(SPEECH_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    console.log('✅ Trascrizione salvata in:', SPEECH_HISTORY_FILE);
  } catch (err) {
    console.error('❌ Errore salvataggio trascrizione:', err);
  }
};

export const useSpeechRecognition = (): SpeechRecognitionHookType => {
  const {sendMessage, registerListener, unregisterListener} =
    useContext(SpeechRecContext);

  const voiceRecognitionActiviatedRef = useRef<boolean>(false);
  const needToStartSpeechRecWhenCancelled = useRef<boolean>(false);

  const languageCodeForSpeechRec = useRef<string>('it-IT');
  useEffect(() => {
    const locales = RNLocalize.getLocales();
    if (locales.length > 0 && locales[0].languageTag) {
      languageCodeForSpeechRec.current = locales[0].languageTag;;
    }
  }, []);

  // ==================== Volume handling Android ====================
  const volumeChangedForSpeechRecRef = useRef<boolean>(false);
  const currentSystemVolumeRef = useRef<number>(0);

  const volumesToChangeForSpeechRec = useMemo(
    () => ['system' as AndroidVolumeTypes],
    [],
  );

  const muteSystemVolume = useCallback(() => {
    if (Platform.OS === 'android') {
      volumesToChangeForSpeechRec.forEach((type?: AndroidVolumeTypes) => {
        VolumeManager.setVolume(0, {showUI: false, type});
      });
    }
  }, [volumesToChangeForSpeechRec]);

  const resumeSystemVolume = useCallback(() => {
    if (Platform.OS === 'android') {
      volumesToChangeForSpeechRec.forEach(type => {
        VolumeManager.setVolume(currentSystemVolumeRef.current, {
          showUI: false,
          type,
        });
      });
    }
  }, [volumesToChangeForSpeechRec]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      VolumeManager.getVolume().then((result: any) => {
        currentSystemVolumeRef.current = result.system || result.volume;
      });
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'android') {
      const volumeListener = VolumeManager.addVolumeListener(result => {
        if (volumeChangedForSpeechRecRef.current) return;
        currentSystemVolumeRef.current = result.system || result.volume;
      });

      return () => {
        volumeListener.remove();
      };
    }
    return () => {};
  }, []);
  // ================================================================

  const [spokenContentInCurrentRound, setSpokenContentInCurrentRound] =
    useState('');
  const spokenContentInCurrentRoundRef = useRef(spokenContentInCurrentRound);
  useEffect(() => {
    spokenContentInCurrentRoundRef.current = spokenContentInCurrentRound;
  }, [spokenContentInCurrentRound]);

  const processCurrentChatRef = useRef((_speechRecResult: string) => {});
  const setSpeechRecCompletedHandler = useCallback(
    (speechRecCompletedHandler: (speechRecResult: string) => void) => {
      processCurrentChatRef.current = speechRecCompletedHandler;
    },
    [],
  );

  const startSpeechRecognitionImpl = useCallback(async () => {
    volumeChangedForSpeechRecRef.current = true;
    muteSystemVolume();
    setSpokenContentInCurrentRound('');

    sendMessage({
      type: SpeechRecReqType.StartSpeechRecognition,
      data: {language: languageCodeForSpeechRec.current},
    });

    voiceRecognitionActiviatedRef.current = true;
    needToStartSpeechRecWhenCancelled.current = false;
  }, [muteSystemVolume, sendMessage]);

  const handleSpeechRecStartRef = useRef(() => {});
  const setSpeechRecStartedHandler = useCallback(
    (speechRecStartedHandler: () => void) => {
      handleSpeechRecStartRef.current = speechRecStartedHandler;
    },
    [],
  );

  const handleSpeechRecErrorRef = useRef((_errorMessage: string) => {});
  const setSpeechRecErrorHandler = useCallback(
    (speechRecErrorHandler: (errorMessage: string) => void) => {
      handleSpeechRecErrorRef.current = speechRecErrorHandler;
    },
    [],
  );

  const onSpeechStartRef = useRef(() => {
    voiceRecognitionActiviatedRef.current = true;
    setSpokenContentInCurrentRound('');
    if (handleSpeechRecStartRef.current) {
      handleSpeechRecStartRef.current();
    }
  });

  const onSpeechEndRef = useRef((transcriptFinalResult: any) => {
    volumeChangedForSpeechRecRef.current = false;
    resumeSystemVolume();
    voiceRecognitionActiviatedRef.current = false;

    if (processCurrentChatRef.current) {
      processCurrentChatRef.current(transcriptFinalResult);
    }

    // 🔹 Salvataggio su file
    if (transcriptFinalResult && transcriptFinalResult.trim().length > 0) {
      saveTranscriptToFile(transcriptFinalResult);
    }

    setSpokenContentInCurrentRound('');

    if (needToStartSpeechRecWhenCancelled.current) {
      startSpeechRecognitionImpl();
    }
  });

  const stopSpeechRecognition = useCallback(async () => {
    if (voiceRecognitionActiviatedRef.current) {
      voiceRecognitionActiviatedRef.current = false;
      sendMessage({type: SpeechRecReqType.StopSpeechRecognition, data: {}});
    }
  }, [sendMessage]);

  const onSpeechResultsRef = useRef((result: any) => {
    if (!voiceRecognitionActiviatedRef.current) return;
    if (result.trim().length === 0) return;
    setSpokenContentInCurrentRound(result);
  });

  const onSpeechErrorRef = useRef(
    ({code, errorMessage}: {code: string; errorMessage: any}) => {
      let isRealError = true;
      switch (code) {
        case 'no-speech':
        case 'aborted':
          isRealError = false;
          break;
        default:
          break;
      }

      if (isRealError && handleSpeechRecErrorRef.current) {
        volumeChangedForSpeechRecRef.current = false;
        resumeSystemVolume();
        handleSpeechRecErrorRef.current(errorMessage);
      }
    },
  );

  useEffect(() => {
    const speechRecStartedListener = onSpeechStartRef.current;
    const speechRecEndListener = onSpeechEndRef.current;
    const speechRecErrorListener = onSpeechErrorRef.current;
    const speechRecRealTimeResultListener = onSpeechResultsRef.current;

    registerListener({
      type: SpeechRecReqType.SpeechRecognitionStarted,
      listener: speechRecStartedListener,
    });
    registerListener({
      type: SpeechRecReqType.SpeechRecognitionEnd,
      listener: speechRecEndListener,
    });
    registerListener({
      type: SpeechRecReqType.SpeechRecognitionError,
      listener: speechRecErrorListener,
    });
    registerListener({
      type: SpeechRecReqType.SpeechRecognitionRealTimeResult,
      listener: speechRecRealTimeResultListener,
    });

    return () => {
      unregisterListener({
        type: SpeechRecReqType.SpeechRecognitionStarted,
        listener: speechRecStartedListener,
      });
      unregisterListener({
        type: SpeechRecReqType.SpeechRecognitionEnd,
        listener: speechRecEndListener,
      });
      unregisterListener({
        type: SpeechRecReqType.SpeechRecognitionError,
        listener: speechRecErrorListener,
      });
      unregisterListener({
        type: SpeechRecReqType.SpeechRecognitionRealTimeResult,
        listener: speechRecRealTimeResultListener,
      });
    };
  }, [registerListener, unregisterListener]);

  const cancelSpeechRecognition = useCallback(async () => {
    if (voiceRecognitionActiviatedRef.current) {
      voiceRecognitionActiviatedRef.current = false;
      sendMessage({type: SpeechRecReqType.CancelSpeechRecognition, data: {}});
    }
  }, [sendMessage]);

  const startSpeechRecognition = useCallback(
    async (languageCode?: string) => {
      if (voiceRecognitionActiviatedRef.current) {
        needToStartSpeechRecWhenCancelled.current = true;
        sendMessage({type: SpeechRecReqType.CancelSpeechRecognition, data: {}});
        return;
      }
      if (languageCode) {
        languageCodeForSpeechRec.current = languageCode;
      }
      startSpeechRecognitionImpl();
    },
    [sendMessage, startSpeechRecognitionImpl],
  );

  return {
    // Actions
    startSpeechRecognition,
    stopSpeechRecognition,
    cancelSpeechRecognition,

    // State
    speechContentRealTime: spokenContentInCurrentRound,

    // Handlers
    setSpeechRecErrorHandler,
    setSpeechRecStartedHandler,
    setSpeechRecCompletedHandler,
  };
};
