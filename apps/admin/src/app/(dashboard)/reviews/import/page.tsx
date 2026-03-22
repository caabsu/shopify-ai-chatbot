'use client';

import { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { useBrand } from '@/components/brand-context';

interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export default function ReviewImportPage() {
  const { brandSlug } = useBrand();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [format, setFormat] = useState('loox');
  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [previewHeaders, setPreviewHeaders] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function parseCSV(text: string): { headers: string[]; rows: string[][] } {
    const lines = text.trim().split('\n');
    if (lines.length === 0) return { headers: [], rows: [] };

    const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1, 6).map((line) =>
      line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '')),
    );
    return { headers, rows };
  }

  function handleFile(file: File) {
    setFileName(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setCsvText(text);
      const { headers, rows } = parseCSV(text);
      setPreviewHeaders(headers);
      setPreviewRows(rows);
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
      handleFile(file);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  async function handleImport() {
    if (!csvText) return;
    setImporting(true);
    setResult(null);

    try {
      const res = await fetch('/api/reviews/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv_text: csvText, format }),
      });
      const data = await res.json();
      setResult({
        imported: data.imported ?? 0,
        skipped: data.skipped ?? 0,
        failed: data.failed ?? 0,
        errors: data.errors ?? [],
      });
    } catch {
      setResult({ imported: 0, skipped: 0, failed: 0, errors: ['Import failed. Please try again.'] });
    }

    setImporting(false);
  }

  function handleReset() {
    setFileName('');
    setCsvText('');
    setPreviewRows([]);
    setPreviewHeaders([]);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const inputStyle = {
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-primary)',
    color: 'var(--text-primary)',
  } as React.CSSProperties;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Upload size={20} style={{ color: 'var(--text-primary)' }} />
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Import Reviews
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Import reviews from a CSV file
          </p>
        </div>
      </div>

      {/* Format selector */}
      <div
        className="rounded-xl p-5"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
        }}
      >
        <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-secondary)' }}>
          Import Format
        </label>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className="w-48 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2"
          style={inputStyle}
        >
          <option value="loox">Loox</option>
          <option value="judge_me">Judge.me</option>
          <option value="yotpo">Yotpo</option>
          <option value="generic">Generic CSV</option>
        </select>
      </div>

      {/* Drop zone */}
      <div
        className="rounded-xl p-8 text-center cursor-pointer transition-colors"
        style={{
          backgroundColor: dragOver
            ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)'
            : 'var(--bg-primary)',
          border: dragOver
            ? '2px dashed var(--color-accent)'
            : '2px dashed var(--border-primary)',
        }}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileInput}
          className="hidden"
        />
        <Upload size={32} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
        {fileName ? (
          <div>
            <div className="flex items-center justify-center gap-2 mb-1">
              <FileText size={14} style={{ color: 'var(--color-accent)' }} />
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {fileName}
              </span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleReset();
              }}
              className="text-xs underline mt-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Choose a different file
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
              Drag & drop a CSV file here
            </p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              or click to browse
            </p>
          </div>
        )}
      </div>

      {/* Preview table */}
      {previewHeaders.length > 0 && (
        <div
          className="rounded-xl overflow-hidden"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
          }}
        >
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-primary)' }}>
            <h3 className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
              Preview (first {previewRows.length} rows)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-secondary)' }}>
                  {previewHeaders.map((h, i) => (
                    <th
                      key={i}
                      className="text-left px-3 py-2 font-semibold whitespace-nowrap"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, ri) => (
                  <tr
                    key={ri}
                    style={{ borderBottom: '1px solid var(--border-secondary)' }}
                  >
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="px-3 py-2 whitespace-nowrap max-w-[200px] truncate"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import button */}
      {csvText && !result && (
        <button
          onClick={handleImport}
          disabled={importing}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          {importing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Importing...
            </>
          ) : (
            <>
              <Upload size={14} />
              Import Reviews
            </>
          )}
        </button>
      )}

      {/* Results */}
      {result && (
        <div
          className="rounded-xl p-5 space-y-3"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
          }}
        >
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Import Results
          </h3>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <CheckCircle size={16} style={{ color: '#22c55e' }} />
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                <strong>{result.imported}</strong> imported
              </span>
            </div>
            {result.skipped > 0 && (
              <div className="flex items-center gap-2">
                <AlertCircle size={16} style={{ color: '#f59e0b' }} />
                <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  <strong>{result.skipped}</strong> skipped (duplicates)
                </span>
              </div>
            )}
            {result.failed > 0 && (
              <div className="flex items-center gap-2">
                <XCircle size={16} style={{ color: '#ef4444' }} />
                <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  <strong>{result.failed}</strong> failed
                </span>
              </div>
            )}
          </div>
          {result.errors.length > 0 && (
            <div
              className="rounded-lg p-3 space-y-1"
              style={{
                backgroundColor: 'rgba(239,68,68,0.06)',
                border: '1px solid rgba(239,68,68,0.15)',
              }}
            >
              <p className="text-xs font-medium" style={{ color: '#ef4444' }}>
                Errors
              </p>
              {result.errors.map((err, i) => (
                <p key={i} className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  {err}
                </p>
              ))}
            </div>
          )}
          <button
            onClick={handleReset}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{ border: '1px solid var(--border-primary)', color: 'var(--text-secondary)' }}
          >
            Import Another File
          </button>
        </div>
      )}
    </div>
  );
}
