import { createContext, useContext } from "react";

export const AskAiContext = createContext(() => {});

export function useAskAi() {
  return useContext(AskAiContext);
}
