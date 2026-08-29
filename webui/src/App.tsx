import { ThemeProvider } from "@/components/theme-provider";
import { ChatPage } from "@/components/chat/ChatPage";

export default function App() {
  return (
    <ThemeProvider>
      <ChatPage />
    </ThemeProvider>
  );
}
