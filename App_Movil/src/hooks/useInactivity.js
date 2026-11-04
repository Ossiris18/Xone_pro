import { useEffect, useRef } from "react";
import { AppState, PanResponder } from "react-native";
import { authServices } from "../services/authServices";

const INACTIVITY_TIME = 30 * 60 * 1000;

export function useInactivity(navigation) {
  const timerRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  function resetTimer() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      await authServices.logout();
      navigation.replace("Welcome");
    }, INACTIVITY_TIME);
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => {
        resetTimer();
        return false;
      },
      onMoveShouldSetPanResponderCapture: () => {
        resetTimer();
        return false;
      },
    })
  ).current;

  useEffect(() => {
    resetTimer();

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (
        appStateRef.current === "active" &&
        nextState.match(/inactive|background/)
      ) {
        resetTimer();
      }
      appStateRef.current = nextState;
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      subscription.remove();
    };
  }, []);

  return panResponder;
}