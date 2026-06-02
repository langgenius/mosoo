import { useNavigate, useParams, useSearchParams } from "react-router-dom";

export interface ThreadRouteState {
  activeThreadId: string | null;
  backToList: () => void;
  closeComposeDialog: () => void;
  composeOpen: boolean;
  lockedAgentId: string | null;
  openComposeDialog: () => void;
  openThread: (threadId: string) => void;
}

export function useThreadRouteState(): ThreadRouteState {
  const navigate = useNavigate();
  const params = useParams<{ threadId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeThreadId = params.threadId ?? null;
  const composeOpen = searchParams.get("compose") === "1";
  const lockedAgentId =
    searchParams.get("lock") === "1" ? (searchParams.get("agent") ?? null) : null;

  function closeComposeDialog(): void {
    setSearchParams(
      (current) => {
        const nextParams = new URLSearchParams(current);
        nextParams.delete("compose");
        nextParams.delete("agent");
        nextParams.delete("lock");
        return nextParams;
      },
      { replace: true },
    );
  }

  function openComposeDialog(): void {
    setSearchParams(
      (current) => {
        const nextParams = new URLSearchParams(current);
        nextParams.set("compose", "1");
        return nextParams;
      },
      { replace: true },
    );
  }

  function openThread(threadId: string): void {
    void navigate(`/threads/${threadId}`);
  }

  function backToList(): void {
    void navigate("/threads");
  }

  return {
    activeThreadId,
    backToList,
    closeComposeDialog,
    composeOpen,
    lockedAgentId,
    openComposeDialog,
    openThread,
  };
}
