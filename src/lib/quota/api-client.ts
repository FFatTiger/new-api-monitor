export const apiFetch = async (endpoint: string, options: RequestInit = {}) => {
  const response = await fetch(`/api${endpoint}`, options);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API Error ${response.status}: ${text}`);
  }

  return response;
};
