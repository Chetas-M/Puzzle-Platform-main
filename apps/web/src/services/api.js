import axios from "axios";
import { getApiBaseUrl } from "./apiBaseUrl";

const api = axios.create({
  baseURL: getApiBaseUrl(),
  withCredentials: true
});

export default api;
