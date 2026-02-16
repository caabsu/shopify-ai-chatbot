import { getState, subscribe } from '../state/store.js';
import type { PresetAction } from '../state/store.js';

export function createPresetActions(onSelect: (presetId: string) => void): HTMLElement {
  const container = document.createElement('div');
  container.className = 'aicb-presets';

  function render(presets: PresetAction[], visible: boolean) {
    container.innerHTML = '';
    container.style.display = visible ? 'flex' : 'none';

    for (const preset of presets) {
      const chip = document.createElement('button');
      chip.className = 'aicb-preset-chip';
      chip.textContent = `${preset.icon} ${preset.label}`;
      chip.addEventListener('click', () => onSelect(preset.id));
      container.appendChild(chip);
    }
  }

  subscribe((state) => {
    render(state.presetActions, !state.hasUserSentMessage && state.presetActions.length > 0);
  });

  return container;
}
