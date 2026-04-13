import { getState } from '../state/store.js';
import type { PresetAction } from '../state/store.js';

export function createHeader(
  onClose: () => void,
  onReset: () => void,
  onPresetClick: (id: string) => void
): HTMLElement {
  const header = document.createElement('div');
  header.className = 'wbd-header';

  const state = getState();

  // Header row: avatar + brand + minimize
  const headerRow = document.createElement('div');
  headerRow.className = 'wbd-header__row';

  headerRow.innerHTML = `
    <div class="wbd-header__brand-row">
      <div class="wbd-header__avatar"></div>
      <span class="wbd-header__brand">Warm by Design</span>
    </div>
    <div class="wbd-header__actions">
      <button class="wbd-header__btn wbd-header__reset" aria-label="New conversation">
        <span class="material-symbols-outlined">refresh</span>
      </button>
      <button class="wbd-header__btn wbd-header__minimize" aria-label="Minimize">
        <span class="material-symbols-outlined">keyboard_arrow_down</span>
      </button>
    </div>
  `;

  header.appendChild(headerRow);

  // Greeting headline
  const greeting = document.createElement('div');
  greeting.className = 'wbd-header__greeting';
  greeting.innerHTML = `Every room deserves <span class="wbd-header__greeting-accent">golden hour.</span>`;
  header.appendChild(greeting);

  // Preset chips
  if (state.presetActions.length > 0) {
    const presetsEl = createPresetChips(state.presetActions, onPresetClick);
    header.appendChild(presetsEl);
  }

  // Event listeners
  header.querySelector('.wbd-header__minimize')!.addEventListener('click', onClose);
  header.querySelector('.wbd-header__reset')!.addEventListener('click', onReset);

  return header;
}

function createPresetChips(presets: PresetAction[], onClick: (id: string) => void): HTMLElement {
  const container = document.createElement('div');
  container.className = 'wbd-presets';

  const ICONS: Record<string, string> = {
    truck: 'local_shipping',
    return: 'undo',
    search: 'search',
    contact: 'support_agent',
    help: 'help_outline',
    sparkles: 'auto_awesome',
  };

  for (const preset of presets) {
    const chip = document.createElement('button');
    chip.className = 'wbd-preset-chip';
    const iconName = ICONS[preset.icon] || 'chat_bubble_outline';
    chip.innerHTML = `<span class="material-symbols-outlined">${iconName}</span>${preset.label}`;
    chip.addEventListener('click', () => onClick(preset.id));
    container.appendChild(chip);
  }

  return container;
}

export function updatePresets(header: HTMLElement, presets: PresetAction[], onClick: (id: string) => void): void {
  const existing = header.querySelector('.wbd-presets');
  if (existing) existing.remove();
  if (presets.length > 0) {
    header.appendChild(createPresetChips(presets, onClick));
  }
}
