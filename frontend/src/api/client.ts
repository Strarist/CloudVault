import axios, { InternalAxiosRequestConfig } from 'axios';
import { getAbortSignal } from './abort-controller';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Flag to prevent automatic retry loops on 401 during logout
let isLoggingOut = false;

export function setLoggingOutFlag(value: boolean): void {
  isLoggingOut = value;
}

// Request interceptor: attach abort signal to all requests for lifecycle management
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  (config as InternalAxiosRequestConfig & { signal?: AbortSignal }).signal = getAbortSignal();
  return config;
});

// Response interceptor: suppress noisy 401 handling during logout
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401 && isLoggingOut) {
      return Promise.reject(new Error('Logout in progress; request cancelled'));
    }
    return Promise.reject(error);
  },
);

export default apiClient;
