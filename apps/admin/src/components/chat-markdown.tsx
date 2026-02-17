'use client';

/**
 * Renders chat markdown the same way the widget does.
 * Supports: bold, italic, links, lists, key-value pairs.
 * Mirrors the widget's renderMarkdown() logic for visual consistency.
 */
export function ChatMarkdown({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
}

function renderMarkdown(text: string): string {
  // 1. Escape HTML
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // 3. Italic (not inside bold)
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

  // 4. Links
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="underline text-gray-900 underline-offset-2 decoration-gray-400 hover:decoration-gray-900">$1</a>'
  );

  // 5. Line-by-line processing
  const lines = html.split('\n');
  const processed: string[] = [];
  let inList = false;

  for (const line of lines) {
    const listMatch = line.match(/^[-*]\s+(.+)$/);

    if (listMatch) {
      if (!inList) {
        processed.push('<ul class="my-1.5 space-y-0.5">');
        inList = true;
      }
      processed.push(`<li class="text-sm text-gray-700 pl-3 relative before:content-[''] before:absolute before:left-0 before:top-[0.6em] before:w-1 before:h-1 before:bg-gray-400 before:rounded-full">${listMatch[1]}</li>`);
    } else {
      if (inList) {
        processed.push('</ul>');
        inList = false;
      }

      const kvMatch = line.match(/^<strong>([^<]+)<\/strong>\s*(?:—|:|–)\s*(.+)$/);
      if (kvMatch) {
        processed.push(`<div class="flex items-baseline gap-2 py-0.5"><span class="text-xs font-semibold text-gray-900 uppercase tracking-wide shrink-0">${kvMatch[1]}</span><span class="text-sm text-gray-600">${kvMatch[2]}</span></div>`);
      } else if (line.trim() === '') {
        processed.push('{{BREAK}}');
      } else {
        processed.push(line);
      }
    }
  }

  if (inList) processed.push('</ul>');

  html = processed.join('\n');
  html = html.replace(/(?:\n?{{BREAK}}\n?)+/g, '</p><p class="mt-2">');
  html = html.replace(/\n/g, '<br>');
  html = '<p>' + html + '</p>';

  // Clean up
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p>(<(?:ul|div)[^>]*>)/g, '$1');
  html = html.replace(/(<\/(?:ul|div)>)<\/p>/g, '$1');
  html = html.replace(/<p><br><\/p>/g, '');
  html = html.replace(/<br>(<div class="flex)/g, '$1');
  html = html.replace(/(shrink-0">.*?<\/span><\/div>)<br>/g, '$1');
  html = html.replace(/<br>(<ul)/g, '$1');
  html = html.replace(/(<\/ul>)<br>/g, '$1');

  return html;
}
