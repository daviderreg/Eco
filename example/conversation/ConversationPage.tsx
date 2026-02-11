import React, {useState, useCallback, useRef, useEffect, useMemo} from 'react';
import {StyleSheet, ScrollView, Alert, View, Modal, Dimensions} from 'react-native';
import {RESULTS} from 'react-native-permissions';
import {Text, Button, TextInput} from 'react-native-paper';
import {SafeAreaView} from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import RNFS from "react-native-fs";
const HISTORY_FILE_PATH = RNFS.DocumentDirectoryPath + "/speechHistory.json";

import {MicrophoneButton} from './MicrophoneButton';
import {MicrophoneButtonTooltip} from './MicrophoneButtonTooltip';
import {
  useCheckSpeechRecPermissions,
  useRequestSpeechRecPermissions,
} from '../hooks/speechRecPermissions';
import {useSpeechRecognition} from 'react-native-voicebox-speech-rec';
import { useVoiceSetup } from '../hooks/useVoiceSetup';
import { useHistoryManager } from "../hooks/useHistoryManager";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    height: '100%',
    width: '100%',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  micContainer: {
    alignItems: 'center',
    position: 'absolute',
    bottom: SCREEN_HEIGHT * 0.08,
  },
  recognizedTextArea: {
    maxHeight: '50%',
    paddingTop: 30,
  },
  textBlack: {
    color: '#000000',
  }
});

export const ConversationPage = React.memo(() => {
  const [isInConversationMode, setIsInConversationMode] = useState(false);
  const [userMicPermissionGranted, setUserMicPermissionGranted] = useState(false);
  const [lastRecognizedText, setLastRecognizedText] = useState<string>('');
  const [assistantResponse, setAssistantResponse] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const conversationCancelledByUser = useRef(false);

  const [recentMessages, setRecentMessages] = useState<{ role: string; content: string }[]>([]);
  const MAX_RECENT_MESSAGES = 5;
  // TTS
  const { speak, stop, voiceReady } = useVoiceSetup();

  // ✅ FIX scroll ref
  const historyScrollRef = useRef<ScrollView>(null);

  // CRONOLOGIA
  const {
    history,
    setHistory,
    isHistoryVisible,
    setIsHistoryVisible,
    historyContent,
    setHistoryContent,
    selectedHistoryIndexes,
    setSelectedHistoryIndexes,
    isEditModalVisible,
    setIsEditModalVisible,
    editableText,
    setEditableText,
    editingIndex,
    setEditingIndex,
    baseContext,
    setBaseContext,
    saveToHistory,
    handleEditSelectedHistory,
    handleSaveEditedHistory,
    clearHistory,
    showHistory,
  } = useHistoryManager("", lastRecognizedText);

  // STT
  const {
    startSpeechRecognition,
    stopSpeechRecognition,
    cancelSpeechRecognition,
    speechContentRealTime,
    setSpeechRecErrorHandler,
    setSpeechRecStartedHandler,
    setSpeechRecCompletedHandler,
  } = useSpeechRecognition();

  /** Speech recognition handlers */
  useEffect(() => {
    setSpeechRecStartedHandler(() => console.log("🎙️ Riconoscimento vocale iniziato"));
    setSpeechRecErrorHandler((errorMessage: any) => {
      Alert.alert("Errore riconoscimento vocale", String(errorMessage));
    });

    setSpeechRecCompletedHandler(async (userChatMessage: string) => {
      if (conversationCancelledByUser.current) return;
      const trimmed = userChatMessage.trim();
      if (!trimmed) return;
      console.log('🎉 Speech Recognition Completed: ', trimmed);
      setLastRecognizedText(trimmed);

      if (!baseContext) {
        Toast.show({
          type: "info",
          text1: "Prima imposta un contesto (salva o seleziona dalla cronologia)",
        });
        return;
      }

      await sendToAssistant(trimmed);
    });
  }, [baseContext, recentMessages]);

  /** Permissions */
  const askForPermission = useRequestSpeechRecPermissions();
  const checkForPermission = useCheckSpeechRecPermissions();

  useEffect(() => {
    checkForPermission().then(res => {
      setUserMicPermissionGranted(res === RESULTS.GRANTED);
    });
  }, [checkForPermission]);

  const checkAndAskForPermission = useCallback(async () => {
    const res = await checkForPermission();
    if (res === RESULTS.GRANTED) return true;
    const req = await askForPermission();
    if (req === RESULTS.GRANTED) {
      setUserMicPermissionGranted(true);
      return true;
    }
    return false;
  }, [askForPermission, checkForPermission]);

  /** Gestione microfono */
  const handleConversationButtonPressed = useCallback(async () => {
    const ok = await checkAndAskForPermission();
    if (!ok) return;
    conversationCancelledByUser.current = false;
    setIsInConversationMode(true);
    startSpeechRecognition('it-IT');
  }, [checkAndAskForPermission, startSpeechRecognition]);

  const handleConversationButtonReleased = useCallback(() => {
    if (!isInConversationMode) return;
    setIsInConversationMode(false);
    stopSpeechRecognition();
  }, [isInConversationMode, stopSpeechRecognition]);

  const handleConversationButtonSwipedUp = useCallback(() => {
    if (isInConversationMode) {
      conversationCancelledByUser.current = true;
      setIsInConversationMode(false);
      cancelSpeechRecognition();
      Toast.show({ type: 'success', text1: 'Riconoscimento vocale cancellato' });
    }
  }, [cancelSpeechRecognition, isInConversationMode]);

  /** Scroll automatico area riconoscimento */
  const scrollRef = useRef<ScrollView>(null);
  const handleTextAreaSizeChange = useCallback(() => {
    scrollRef.current?.scrollToEnd({animated: true});
  }, []);

  const speechRecContentArea = useMemo(() => (
    <Text variant="titleLarge" style={styles.textBlack}>
      {speechContentRealTime || lastRecognizedText}
    </Text>
  ), [speechContentRealTime, lastRecognizedText]);

  /** Invio a Gemma */
  const sendToAssistant = async (userMessage: string) => {
    try {
      if (!baseContext) {
        console.log("⚠️ Nessun contesto attivo.");
        return;
      }

      setLoading(true);
      setAssistantResponse("");

      setRecentMessages(prev => {
        const updated = [...prev, { role: "user", content: userMessage }];
        return updated.slice(-MAX_RECENT_MESSAGES);
      });

      const memoryContext = recentMessages
        .map(m => `${m.role === "user" ? "Utente" : "Assistente"}: ${m.content}`)
        .join("\n");

      const systemInstructions = `
        Istruzioni per Gemma:

        1. Sei una voce familiare che parla con una persona autistica. Usa frasi molto brevi, calme, positive e naturali.

        2. Risposte alle domande nel CONTESTO UTENTE:
           - Se la domanda riguarda qualcosa presente nel contesto, rispondi **come indicato nel contesto**.
           - Non aggiungere dettagli secondari o spiegazioni non richiesti.
           - Mantieni sempre la prospettiva dell’utente: usa “tuo”, “tua”, ecc.

        3. Risposte alle domande fuori dal CONTESTO UTENTE:
           - Se riguarda fatti personali o oggetti non menzionati nel contesto, rispondi “Non lo so di preciso.”
           - Se riguarda argomenti generali (es. meteo, curiosità, orario, fatti del mondo), rispondi normalmente e gentilmente.
           - **Non inventare mai informazioni personali.**

        4. Affermazioni:
           - Se l’utente fa un’affermazione (non una domanda), rispondi accogliendo ciò che dice senza aggiungere altro.
           - Mantieni sempre la prospettiva dell’utente.

        5. Regola sulle ripetizioni:
                 - **Se la DOMANDA UTENTE è presente due volte consecutive nella MEMORIA RECENTE, rispondi normalmente ma aggiungi anche una domanda per cercare di cambiare argomento (es. vuoi parlare di qualcos'altro?).**

        6. Lunghezza e stile:
           - Risposte sempre brevi, naturali e positive.
           - Evita aggiunte descrittive o dettagli non richiesti.
        `;

      const messagesToSend = [
        { role: "system", content: systemInstructions },
        { role: "user", content: `CONTESTO UTENTE:\n${baseContext}` },
        { role: "user", content: `MEMORIA RECENTE:\n${memoryContext || "(nessuna conversazione recente)"}` },
        { role: "user", content: `DOMANDA UTENTE:\n${userMessage}` },
      ];


      console.log("🧠 Messaggi inviati a Gemma:", messagesToSend);


      const response = await fetch("http://<IPconfig>/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemma3:4b-it-qat",
          messages: messagesToSend,
          stream: false,
        }),
      });

      if (!response.ok) throw new Error(`Errore ${response.status}`);
      const data = await response.json();

      const reply = data.choices?.[0]?.message?.content || "Nessuna risposta";
      console.log("🤖 Risposta Gemma:", reply);
      setAssistantResponse(reply);

      stop();
      speak(reply);
    } catch (err: any) {
      console.error("Errore Assistente:", err);
      Alert.alert("Errore Assistente", err.message);
    } finally {
      setLoading(false);
    }
  };

  /** UI */
  return (
    <SafeAreaView style={styles.container}>
      {loading && (
        <Text style={[styles.textBlack, { textAlign: 'center', marginBottom: 10, fontStyle: 'italic' }]}>
          🤔 eco sta pensando...
        </Text>
      )}

      <ScrollView ref={scrollRef} onContentSizeChange={handleTextAreaSizeChange} style={styles.recognizedTextArea}>
        {speechRecContentArea}
        {assistantResponse ? (
          <Text style={[styles.textBlack, { marginTop: 20, fontSize: 16 }]}>
            🤖 {assistantResponse}
          </Text>
        ) : null}
      </ScrollView>

      {/* 🔘 Pulsanti principali */}
      <View style={{ width: '100%', marginTop: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
          <Button mode="contained" style={{ flex: 0.48 }} onPress={saveToHistory}>
            💾 Salva
          </Button>
          <Button mode="contained" style={{ flex: 0.48 }} onPress={showHistory}>
            📜 Cronologia
          </Button>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Button mode="contained" style={{ flex: 0.48, backgroundColor: '#17a2b8' }} onPress={() => stop()}>
            🔇 Stop
          </Button>
          <Button mode="contained" style={{ flex: 0.48, backgroundColor: '#17a2b8' }} onPress={() => speak(assistantResponse)}>
            🔊 Riascolta
          </Button>
        </View>
      </View>

      {/* 🎙️ Pulsante microfono */}
      <MicrophoneButton
        containerStyle={styles.micContainer}
        disabled={false}
        handleButtonPressed={handleConversationButtonPressed}
        handleButtonReleased={handleConversationButtonReleased}
        handleButtonSwipeUp={handleConversationButtonSwipedUp}
        isInListeningMode={isInConversationMode}
        tooltipText={
          <MicrophoneButtonTooltip
            userIsSpeaking={isInConversationMode}
            userMicPermissionBlocked={userMicPermissionGranted === false}
          />
        }
      />

      <Toast />

      {/* 📜 Modal cronologia */}
      <Modal visible={isHistoryVisible} animationType="fade" transparent onRequestClose={() => setIsHistoryVisible(false)}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#17a2b8', padding: 20 }}>
          <View style={{ width: '100%', maxHeight: '70%', backgroundColor: 'white', borderRadius: 12, padding: 20 }}>
            <Text style={[styles.textBlack, { fontSize: 18, fontWeight: 'bold', marginBottom: 10 }]}>
              📖 Cronologia
            </Text>

            <ScrollView ref={historyScrollRef}>
              {historyContent.map((msg, i) => {
                const selected = selectedHistoryIndexes.includes(i);
                return (
                  <Text
                    key={i}
                    style={{
                      marginBottom: 6,
                      padding: 8,
                      backgroundColor: selected ? '#cce5ff' : 'transparent',
                      borderRadius: 6,
                      color: '#000000',
                    }}
                    onPress={() => {
                      if (selected) {
                        setSelectedHistoryIndexes(prev => prev.filter(idx => idx !== i));
                      } else {
                        setSelectedHistoryIndexes(prev => [...prev, i]);
                      }
                    }}
                  >
                    {i + 1}. {msg}
                  </Text>
                );
              })}
            </ScrollView>

            {/* ✏️ Modifica visibile solo se una selezione */}
            {selectedHistoryIndexes.length === 1 && (
              <Button mode="contained" style={{ marginTop: 10, backgroundColor: '#f0ad4e' }} onPress={handleEditSelectedHistory}>
                ✏️ Modifica questa
              </Button>
            )}

            {/* 🗑️ Cancella selezionati */}
            {selectedHistoryIndexes.length > 0 && (
              <Button
                mode="contained"
                style={{ marginTop: 10, backgroundColor: '#dc3545' }}
                onPress={async () => {
                  try {
                    const updatedHistory = historyContent.filter(
                      (_, idx) => !selectedHistoryIndexes.includes(idx)
                    );
                    await RNFS.writeFile(HISTORY_FILE_PATH, JSON.stringify(updatedHistory), 'utf8');
                    setHistoryContent(updatedHistory);
                    setHistory(updatedHistory);
                    setSelectedHistoryIndexes([]);
                    if (updatedHistory.length === 0) setBaseContext(null);
                    historyScrollRef.current?.scrollTo({ y: 0, animated: true }); // ✅ FIX
                    Toast.show({ type: 'success', text1: 'Voci selezionate cancellate!' });
                  } catch (err) {
                    console.error('Errore cancellazione selettiva:', err);
                    Toast.show({ type: 'error', text1: 'Errore durante la cancellazione' });
                  }
                }}
              >
                🗑️ Cancella selezionati
              </Button>
            )}

            {/* 🚀 Imposta contesto */}
            <Button
              mode="contained"
              style={{ marginTop: 10 }}
              onPress={() => {
                if (selectedHistoryIndexes.length === 0) {
                  Alert.alert('Avvio bloccato', 'Seleziona almeno una conversazione dalla cronologia.');
                  return;
                }
                const combined = selectedHistoryIndexes.map(i => historyContent[i]).join('\n');
                setBaseContext(combined);
                console.log('📌 Contesto impostato da CRONOLOGIA:', combined);
                setIsHistoryVisible(false);
                Toast.show({ type: 'success', text1: 'Contesto impostato da cronologia!' });
              }}
            >
              🚀 Imposta contesto
            </Button>

            {/* ❌ Chiudi */}
            <Button mode="contained" style={{ marginTop: 10 }} onPress={() => setIsHistoryVisible(false)}>
              Chiudi
            </Button>
          </View>
        </View>
      </Modal>
      {/* ✏️ Modal modifica voce */}
      <Modal
        visible={isEditModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setIsEditModalVisible(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(0,0,0,0.5)',
            padding: 20,
          }}
        >
          <View
            style={{
              width: '100%',
              maxHeight: '80%', // ✅ Limita l'altezza per permettere scroll
              backgroundColor: 'white',
              borderRadius: 12,
              padding: 20,
            }}
          >
            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ flexGrow: 1 }}
              keyboardShouldPersistTaps="handled"
            >
              <Text
                style={[
                  styles.textBlack,
                  { fontSize: 18, fontWeight: 'bold', marginBottom: 10 },
                ]}
              >
                ✏️ Modifica voce cronologia
              </Text>

              <TextInput
                mode="outlined"
                multiline
                value={editableText}
                onChangeText={setEditableText}
                style={{
                  minHeight: 180, // ✅ Più spazio
                  maxHeight: 400, // ✅ Scroll interno
                  marginBottom: 15,
                  textAlignVertical: 'top', // ✅ Allinea testo in alto
                }}
              />

              <Button mode="contained" onPress={handleSaveEditedHistory}>
                💾 Salva modifiche
              </Button>
              <Button
                mode="outlined"
                style={{ marginTop: 10 }}
                onPress={() => setIsEditModalVisible(false)}
              >
                Annulla
              </Button>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
});
ConversationPage.displayName = 'ConversationPage';

