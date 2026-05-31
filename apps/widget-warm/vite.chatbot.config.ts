import { widgetLib } from './vite.shared';

// First Warm bundle built — clears dist; the rest leave emptyOutDir false.
export default widgetLib({ entry: 'src/chatbot/chatbot.ts', name: 'WarmChatbot', fileName: 'chatbot.js', clearDist: true });
