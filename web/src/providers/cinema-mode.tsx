import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface CinemaModeContextValue {
  cinemaMode: boolean;
  toggleCinemaMode(): void;
  setCinemaMode(value: boolean): void;
}

const CinemaModeContext = createContext<CinemaModeContextValue | null>(null);

const STORAGE_KEY = "cinema-mode";

function readInitialCinemaMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get("cinemaMode") === "true") {
    return true;
  }
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function CinemaModeProvider({ children }: { children: ReactNode }) {
  const [cinemaMode, setCinemaMode] = useState(readInitialCinemaMode);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(cinemaMode));
  }, [cinemaMode]);

  const toggleCinemaMode = useCallback(() => setCinemaMode((prev) => !prev), []);

  const value = useMemo<CinemaModeContextValue>(
    () => ({ cinemaMode, toggleCinemaMode, setCinemaMode }),
    [cinemaMode, toggleCinemaMode],
  );

  return <CinemaModeContext value={value}>{children}</CinemaModeContext>;
}

export function useCinemaMode(): CinemaModeContextValue {
  const context = useContext(CinemaModeContext);
  if (context === null) {
    throw new Error("useCinemaMode must be used within a CinemaModeProvider");
  }
  return context;
}
