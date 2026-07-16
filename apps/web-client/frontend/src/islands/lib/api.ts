// Same-origin fetch helpers for the islands: the Django session cookie rides
// along, CSRF token comes from the mount props (server-rendered).

let csrfToken = "";

export function setCsrfToken(token: string) {
  csrfToken = token;
}

export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-Requested-With": "fetch" },
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return (await response.json()) as T;
}

export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Requested-With": "fetch",
      "X-CSRFToken": csrfToken,
    },
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `POST ${url} -> ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      /* keep the default message */
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function postForm<T>(url: string, fields: Record<string, string>): Promise<T> {
  const body = new URLSearchParams(fields);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "X-Requested-With": "fetch",
      "X-CSRFToken": csrfToken,
    },
    credentials: "same-origin",
    body,
  });
  if (!response.ok) throw new Error(`POST ${url} -> ${response.status}`);
  return (await response.json()) as T;
}

export function readMountProps<T>(elementId: string): T | null {
  const el = document.getElementById(elementId);
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as T;
  } catch {
    return null;
  }
}
