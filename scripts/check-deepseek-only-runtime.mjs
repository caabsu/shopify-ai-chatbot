import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scanTargets = [
  'apps/backend/src',
  'apps/admin/src',
  'apps/backend/package.json',
  'apps/admin/package.json',
  '.env.example',
];

const forbidden = [
  { label: 'Anthropic SDK import/dependency', pattern: /@anthropic-ai\/sdk/i },
  { label: 'Anthropic credential', pattern: /ANTHROPIC_API_KEY/ },
  { label: 'Claude model identifier', pattern: /claude-(?:haiku|sonnet|opus|\d)/i },
  { label: 'Anthropic client construction', pattern: /new\s+Anthropic\s*\(/ },
  { label: 'Anthropic messages call', pattern: /anthropic\.messages/i },
  { label: 'legacy Claude fallback', pattern: /anthropic-legacy/i },
];

async function filesAt(relativeTarget) {
  const absoluteTarget = path.join(root, relativeTarget);
  if (!relativeTarget.endsWith('/src')) return [absoluteTarget];

  const files = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile() && /\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
        files.push(absolute);
      }
    }
  };
  await visit(absoluteTarget);
  return files;
}

const violations = [];
for (const target of scanTargets) {
  for (const file of await filesAt(target)) {
    const content = await readFile(file, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const rule of forbidden) {
      lines.forEach((line, index) => {
        if (rule.pattern.test(line)) {
          violations.push(
            `${path.relative(root, file)}:${index + 1}: ${rule.label}: ${line.trim()}`,
          );
        }
      });
    }
  }
}

if (violations.length > 0) {
  console.error('DeepSeek-only runtime guard failed:\n');
  console.error(violations.map((violation) => `- ${violation}`).join('\n'));
  process.exit(1);
}

console.log('DeepSeek-only runtime guard passed.');
