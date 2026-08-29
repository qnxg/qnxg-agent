import { ChatPage } from "@/components/chat/ChatPage";
import { ThemeProvider } from "@/components/theme-provider";

export default function App() {
	return (
		<ThemeProvider>
			<ChatPage />
		</ThemeProvider>
	);
}
