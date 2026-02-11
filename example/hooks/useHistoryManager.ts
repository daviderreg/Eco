import { useState, useCallback } from "react";
import RNFS from "react-native-fs";
import Toast from "react-native-toast-message";
import { Alert } from "react-native";

const HISTORY_FILE_PATH = RNFS.DocumentDirectoryPath + "/speechHistory.json";

export const useHistoryManager = (
  speechContentRealTime: string,
  lastRecognizedText: string
) => {
  const [history, setHistory] = useState<string[]>([]);
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const [historyContent, setHistoryContent] = useState<string[]>([]);
  const [selectedHistoryIndexes, setSelectedHistoryIndexes] = useState<number[]>([]);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editableText, setEditableText] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [baseContext, setBaseContext] = useState<string | null>(null);

  /** ***************************************************************
   * 💾 Salva una nuova voce nella cronologia
   *************************************************************** */
  const saveToHistory = useCallback(async () => {
    try {
      const textToSave = speechContentRealTime || lastRecognizedText;
      if (!textToSave.trim()) {
        Toast.show({ type: "info", text1: "Nessun testo da salvare" });
        return;
      }

      let existing: string[] = [];
      const exists = await RNFS.exists(HISTORY_FILE_PATH);
      if (exists) {
        const fileContents = await RNFS.readFile(HISTORY_FILE_PATH, "utf8");
        existing = JSON.parse(fileContents) as string[];
      }

      const newHistory = [...existing, textToSave];
      await RNFS.writeFile(HISTORY_FILE_PATH, JSON.stringify(newHistory), "utf8");
      setHistory(newHistory);

      setBaseContext(textToSave);
      console.log("📌 Contesto impostato dalla PRIMA registrazione:", textToSave);

      Toast.show({ type: "success", text1: "Prima registrazione salvata come contesto!" });
    } catch (err) {
      console.error("Error saving history:", err);
    }
  }, [speechContentRealTime, lastRecognizedText]);

  /** ***************************************************************
   * ✏️ Apri editor per voce selezionata
   *************************************************************** */
  const handleEditSelectedHistory = useCallback(() => {
    if (selectedHistoryIndexes.length !== 1) {
      Alert.alert("Modifica non disponibile", "Seleziona una sola voce per modificarla.");
      return;
    }

    const index = selectedHistoryIndexes[0];
    const selectedText = historyContent[index];
    setEditingIndex(index);
    setEditableText(selectedText);
    setIsEditModalVisible(true);
  }, [selectedHistoryIndexes, historyContent]);

  /** ***************************************************************
   * 💾 Salva testo modificato
   *************************************************************** */
  const handleSaveEditedHistory = useCallback(async () => {
    try {
      if (editingIndex === null) return;

      const updatedHistory = [...historyContent];
      updatedHistory[editingIndex] = editableText;

      await RNFS.writeFile(HISTORY_FILE_PATH, JSON.stringify(updatedHistory), "utf8");
      setHistoryContent(updatedHistory);
      setHistory(updatedHistory);
      setIsEditModalVisible(false);
      Toast.show({ type: "success", text1: "Voce cronologia aggiornata!" });
    } catch (err) {
      console.error("Errore durante salvataggio modifica:", err);
    }
  }, [editableText, editingIndex, historyContent]);

  /** ***************************************************************
   * 🗑️ Elimina tutta la cronologia
   *************************************************************** */
  const clearHistory = useCallback(async () => {
    try {
      await RNFS.unlink(HISTORY_FILE_PATH);
      setHistory([]);
      setBaseContext(null);
      Toast.show({ type: "success", text1: "Cronologia cancellata" });
    } catch (err) {
      console.error("Error clearing history:", err);
    }
  }, []);

  /** ***************************************************************
   * 📜 Mostra cronologia
   *************************************************************** */
  const showHistory = useCallback(async () => {
    try {
      const exists = await RNFS.exists(HISTORY_FILE_PATH);
      if (!exists) {
        Toast.show({ type: "info", text1: "Nessuna cronologia salvata" });
        return;
      }
      const fileContents = await RNFS.readFile(HISTORY_FILE_PATH, "utf8");
      setHistoryContent(JSON.parse(fileContents) as string[]);
      setIsHistoryVisible(true);
    } catch (err) {
      console.error("Errore nel leggere la cronologia:", err);
    }
  }, []);

  return {
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
  };
};
