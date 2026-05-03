import { submitReview, uploadMedia } from '../api/client';

const STAR_PATH =
  'M12 2 L14.85 8.78 L22.18 9.27 L16.55 13.97 L18.31 21.13 L12 17.27 L5.69 21.13 L7.45 13.97 L1.82 9.27 L9.15 8.78 Z';

export function renderComposer(handle: string, onSubmitted: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'wbd-rv-composer';
  el.innerHTML = `
    <div class="wbd-rv-composer-head">
      <div class="l">
        <span class="e">Write a review</span>
        <h3>Tell us how it lives in your space.</h3>
      </div>
      <div class="r">~ 2 minutes</div>
    </div>
    <div class="wbd-rv-composer-body">
      <div class="wbd-rv-row2">
        <div class="wbd-rv-field">
          <span class="lbl">Rating</span>
          <span class="wbd-rv-rater" data-rating="0" role="radiogroup">
            ${[1, 2, 3, 4, 5]
              .map((i) => `<svg data-v="${i}" viewBox="0 0 24 24"><path fill="currentColor" d="${STAR_PATH}"/></svg>`)
              .join('')}
          </span>
        </div>
        <div class="wbd-rv-field">
          <span class="lbl">Photos</span>
          <label class="wbd-rv-dropzone">
            <span data-dz-label>Drop photos or browse</span>
            <input type="file" data-files multiple accept="image/*" hidden>
          </label>
        </div>
      </div>
      <div class="wbd-rv-field">
        <span class="lbl">Headline</span>
        <input class="wbd-rv-input" data-title placeholder="A short, honest summary.">
      </div>
      <div class="wbd-rv-field">
        <span class="lbl">Review</span>
        <textarea class="wbd-rv-textarea" data-body required placeholder="What stood out? How does it feel in your home?"></textarea>
      </div>
      <div class="wbd-rv-row2">
        <div class="wbd-rv-field">
          <span class="lbl">Name</span>
          <input class="wbd-rv-input" data-name required placeholder="e.g. Marcus K.">
        </div>
        <div class="wbd-rv-field">
          <span class="lbl">Email</span>
          <input class="wbd-rv-input" data-email type="email" required placeholder="you@example.com">
        </div>
      </div>
    </div>
    <div class="wbd-rv-composer-foot">
      <span class="note" data-status>Email is private. Not published.</span>
      <button class="wbd-rv-btn wbd-rv-btn-primary" data-submit>Submit</button>
    </div>
  `;

  const rater = el.querySelector<HTMLElement>('.wbd-rv-rater')!;
  rater.querySelectorAll<SVGElement>('svg').forEach((svg) => {
    const set = () => {
      rater.dataset.rating = svg.dataset.v || '0';
    };
    svg.addEventListener('click', set);
    svg.addEventListener('mouseenter', set);
  });

  const fileInput = el.querySelector<HTMLInputElement>('[data-files]')!;
  const dzLabel = el.querySelector<HTMLElement>('[data-dz-label]')!;
  fileInput.addEventListener('change', () => {
    const count = fileInput.files?.length ?? 0;
    dzLabel.textContent = count === 0 ? 'Drop photos or browse' : `${count} photo${count === 1 ? '' : 's'} selected`;
  });

  const status = el.querySelector<HTMLElement>('[data-status]')!;
  const button = el.querySelector<HTMLButtonElement>('[data-submit]')!;
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    const rating = Number(rater.dataset.rating || '0');
    const title = (el.querySelector<HTMLInputElement>('[data-title]')!.value || '').trim();
    const body = (el.querySelector<HTMLTextAreaElement>('[data-body]')!.value || '').trim();
    const name = (el.querySelector<HTMLInputElement>('[data-name]')!.value || '').trim();
    const email = (el.querySelector<HTMLInputElement>('[data-email]')!.value || '').trim();

    if (!rating) return setStatus('Choose a rating to continue.');
    if (!body) return setStatus('Add a few words about how it lives.');
    if (!name) return setStatus('A first name + last initial is enough.');
    if (!email) return setStatus('We need an email to verify the review.');

    button.disabled = true;
    button.textContent = 'Submitting...';
    try {
      const media_urls: string[] = [];
      for (const file of Array.from(fileInput.files ?? []).slice(0, 5)) {
        const upload = await uploadMedia(file);
        media_urls.push(upload.url);
      }
      await submitReview({
        product_handle: handle,
        customer_email: email,
        customer_name: name,
        rating,
        body,
        title: title || undefined,
        media_urls,
      });
      el.innerHTML = `<div class="wbd-rv-thanks"><h3>Thank you.</h3><p>Your review is in. We'll publish it shortly.</p></div>`;
      onSubmitted();
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Submit';
      setStatus(error instanceof Error ? error.message : 'Something went wrong. Try again.');
    }
  });

  function setStatus(message: string): void {
    status.textContent = message;
  }

  return el;
}

