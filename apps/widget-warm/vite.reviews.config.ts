import { widgetLib } from './vite.shared';

// Reviews widget tags its injected <style> with data-wbd-rv for storefront scoping.
export default widgetLib({ entry: 'src/reviews/reviews.ts', name: 'WBDReviews', fileName: 'reviews.js', styleAttr: ['data-wbd-rv', '1'] });
