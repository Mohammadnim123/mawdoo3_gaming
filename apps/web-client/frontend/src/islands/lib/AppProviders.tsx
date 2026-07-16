// App-wide providers for Django-mounted islands — the islands-build port of
// the reference `app/providers.tsx` (same query-client options, same nesting).
// The locale comes from `<html lang>` (Django renders it), not a prop.
import { useState, type ReactElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@codply/contracts";
import { ToastProvider } from "@codply/ui";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { I18nProvider, useI18n } from "@/components/i18n/I18nProvider";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: (failureCount, error) => {
          // Never retry auth/permission/not-found failures.
          if (ApiError.isApiError(error) && error.status < 500 && error.status !== 429) {
            return false;
          }
          return failureCount < 2;
        },
      },
    },
  });
}

/** ToastProvider with localized chrome labels (needs the i18n context). */
function LocalizedToastProvider({ children }: { children: ReactNode }): ReactElement {
  const { t } = useI18n();
  return (
    <ToastProvider
      labels={{ region: t.ui.notificationsRegion, dismiss: t.ui.dismissNotification }}
    >
      {children}
    </ToastProvider>
  );
}

export function AppProviders({ children }: { children: ReactNode }): ReactElement {
  const [queryClient] = useState(makeQueryClient);
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <LocalizedToastProvider>{children}</LocalizedToastProvider>
        </I18nProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
