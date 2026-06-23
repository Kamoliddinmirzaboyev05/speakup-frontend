import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import { ThemeProvider } from "./app/theme.tsx";
import { ToastProvider } from "./app/toast.tsx";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <ToastProvider>
      <App />
    </ToastProvider>
  </ThemeProvider>
);
