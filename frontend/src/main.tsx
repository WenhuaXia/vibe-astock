import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { router } from "./router";
import { primeCliAvailability } from "./lib/ai-models";
import { authHeaders } from "./lib/api";
import { primeLlmConfig } from "./lib/llm";
import "./index.css";

// 先把"哪些订阅 CLI 能用"和"配没配 LLM（服务端单一来源）"拉到全局缓存 ——
// 不阻塞首屏：拉不到就按"还不知道"处理，由服务端 400 / 设置页提示兜底。
void primeCliAvailability(authHeaders());
void primeLlmConfig();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" theme="dark" richColors closeButton duration={3500} />
    </ErrorBoundary>
  </StrictMode>
);
