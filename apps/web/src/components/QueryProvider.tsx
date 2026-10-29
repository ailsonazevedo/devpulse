"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkApiError } from "@/components/work/api";

/**
 * Cache de dados no navegador (TanStack Query): reabrir uma tarefa, trocar de
 * board ou voltar à lista mostra o que já foi carregado na hora e atualiza em
 * segundo plano.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 30 * 60_000,
            refetchOnWindowFocus: false,
            // erros de domínio (auth, escopo, 404, entrada) não melhoram tentando de novo
            retry: (count, err) =>
              !(err instanceof WorkApiError && err.status < 500) && count < 1,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
