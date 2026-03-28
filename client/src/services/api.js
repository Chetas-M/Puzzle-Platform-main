import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:4000/api"
});

let authAccess = {
  getAuth: () => null,
  setAuth: () => {},
  onAuthFailure: () => {}
};

let refreshPromise = null;

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    return;
  }
  delete api.defaults.headers.common.Authorization;
}

export function registerAuthHandlers(handlers) {
  authAccess = {
    ...authAccess,
    ...handlers
  };
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const requestConfig = error.config || {};
    const status = error?.response?.status;
    const requestUrl = `${requestConfig.url || ""}`;

    if (
      status !== 401 ||
      requestConfig._retry ||
      requestConfig.skipAuthRefresh ||
      requestUrl.includes("/auth/login") ||
      requestUrl.includes("/auth/admin-login") ||
      requestUrl.includes("/auth/refresh")
    ) {
      return Promise.reject(error);
    }

    const currentAuth = authAccess.getAuth?.();
    const refreshToken = currentAuth?.refreshToken;
    if (!refreshToken) {
      authAccess.onAuthFailure?.();
      return Promise.reject(error);
    }

    if (!refreshPromise) {
      refreshPromise = api
        .post(
          "/auth/refresh",
          { refreshToken },
          {
            skipAuthRefresh: true
          }
        )
        .then((response) => {
          const nextAuth = {
            ...currentAuth,
            token: response.data.token,
            refreshToken: response.data.refreshToken
          };
          authAccess.setAuth?.(nextAuth);
          setAuthToken(nextAuth.token);
          return nextAuth;
        })
        .catch((refreshError) => {
          authAccess.onAuthFailure?.();
          throw refreshError;
        })
        .finally(() => {
          refreshPromise = null;
        });
    }

    await refreshPromise;
    requestConfig._retry = true;
    requestConfig.headers = {
      ...(requestConfig.headers || {}),
      Authorization: api.defaults.headers.common.Authorization
    };
    return api(requestConfig);
  }
);

export default api;
