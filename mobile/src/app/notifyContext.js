import { createContext, useContext } from "react";

export const NotifyContext = createContext(() => {});

export function useNotify() {
  return useContext(NotifyContext);
}
