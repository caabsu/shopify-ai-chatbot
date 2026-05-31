import { widgetLib } from './vite.shared';

// First widget bundle built — clears dist; the rest leave emptyOutDir false.
export default widgetLib({ entry: 'src/widget.ts', name: 'ShopifyChatWidget', fileName: 'widget.js', clearDist: true });
