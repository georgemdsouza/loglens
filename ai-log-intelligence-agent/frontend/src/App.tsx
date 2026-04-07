import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ReactNode } from 'react'

type LogMatch = {
  file_path: string
  line_number: number
  timestamp: string | null
  message: string
  context_before: { line_number: number; message: string }[]
  context_after: { line_number: number; message: string }[]
}

type Summary = {
  total_files_scanned: number
  total_lines_scanned: number
  total_matches: number
  top_patterns: [string, number][]
}

type SearchResponse = {
  matches: LogMatch[]
  summary: Summary
  truncated: boolean
}

type ScanConfig = {
  scan_root: string
  exists: boolean
  readable: boolean
  total_files_under_root: number
}

type ScanStatus = {
  search_id: string
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'not_found'
  started_at: string | null
  updated_at: string | null
  current_file: string | null
  total_files: number
  files_scanned: number
  lines_scanned: number
  matches_found: number
  message: string
}

type ScanFileResponse = {
  total_files: number
  files: { path: string; relative_path: string }[]
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'
const PAGE_SIZE = 50

function App() {
  const [subfolder, setSubfolder] = useState('')
  const [scanConfig, setScanConfig] = useState<ScanConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)

  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [contextLines, setContextLines] = useState(0)
  const [keyword, setKeyword] = useState('')
  const [terms, setTerms] = useState<string[]>(['', ''])
  const [termsOperator, setTermsOperator] = useState<'and' | 'or'>('and')
  const [regexMode, setRegexMode] = useState(false)
  const [caseInsensitive, setCaseInsensitive] = useState(true)
  const [includeLog, setIncludeLog] = useState(true)
  const [includeTxt, setIncludeTxt] = useState(true)
  const [includeGz, setIncludeGz] = useState(true)
  const [includeNoExt, setIncludeNoExt] = useState(true)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<SearchResponse | null>(null)
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null)
  const [activeSearchId, setActiveSearchId] = useState<string | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const [page, setPage] = useState(1)
  const [availableFiles, setAvailableFiles] = useState<string[]>([])
  const [allFilesSelected, setAllFilesSelected] = useState(true)
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  useEffect(() => {
    if (!loading || !activeSearchId) {
      return
    }

    const poll = async () => {
      try {
        const response = await fetch(`${API_BASE}/search-status?search_id=${encodeURIComponent(activeSearchId)}`)
        if (!response.ok) return
        const data: ScanStatus = await response.json()
        setScanStatus(data)
      } catch {
        // best-effort polling; do not block user workflow
      }
    }

    void poll()
    const id = window.setInterval(() => void poll(), 1000)
    return () => window.clearInterval(id)
  }, [loading, activeSearchId])


  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch(`${API_BASE}/config`)
        if (!response.ok) {
          throw new Error('Failed to load backend mounted path config')
        }
        const data: ScanConfig = await response.json()
        setScanConfig(data)

        if (!data.exists || !data.readable) {
          setError('Mounted log folder is not accessible. Check Docker volume and LOG_FOLDER in .env.')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect to backend')
      } finally {
        setConfigLoading(false)
      }
    }

    void loadConfig()
  }, [])

  const totalPages = useMemo(() => {
    if (!results) return 1
    return Math.max(1, Math.ceil(results.matches.length / PAGE_SIZE))
  }, [results])

  const paginatedMatches = useMemo(() => {
    if (!results) return []
    const start = (page - 1) * PAGE_SIZE
    return results.matches.slice(start, start + PAGE_SIZE)
  }, [results, page])

  const includeExtensions = useMemo(() => {
    const ext: string[] = []
    if (includeLog) ext.push('.log')
    if (includeTxt) ext.push('.txt')
    if (includeGz) ext.push('.gz')
    if (includeNoExt) ext.push('[none]')
    return ext
  }, [includeLog, includeTxt, includeGz, includeNoExt])

  const toDateTime = (dateValue: string, timeValue: string): string | null => {
    if (!dateValue) return null
    const time = timeValue || '00:00:00'
    const normalizedTime = time.length === 5 ? `${time}:00` : time
    return `${dateValue}T${normalizedTime}`
  }

  const buildPayload = () => {
    const start = toDateTime(startDate, startTime)
    const end = toDateTime(endDate, endTime || '23:59:59')
    const cleanedTerms = terms.map((t) => t.trim()).filter(Boolean)
    const searchId = activeSearchId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    return {
      search_id: searchId,
      subfolder: subfolder.trim(),
      include_extensions: includeExtensions,
      selected_files: allFilesSelected ? [] : selectedFiles,
      date_range: start || end ? { start, end } : null,
      context_lines: contextLines,
      filters: {
        keyword,
        terms: cleanedTerms,
        terms_operator: termsOperator,
        regex_mode: regexMode,
        case_insensitive: caseInsensitive,
      },
    }
  }

  const loadFiles = async () => {
    setFilesLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API_BASE}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subfolder: subfolder.trim(),
          include_extensions: includeExtensions,
          selected_files: [],
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({ detail: 'Unable to load files' }))
        throw new Error(body.detail || 'Unable to load files')
      }
      const data: ScanFileResponse = await response.json()
      const rel = data.files.map((f) => f.relative_path)
      setAvailableFiles(rel)
      if (!allFilesSelected) {
        setSelectedFiles((prev) => prev.filter((f) => rel.includes(f)))
      }
    } catch (err) {
      setAvailableFiles([])
      setSelectedFiles([])
      setError(err instanceof Error ? err.message : 'Unable to load files')
    } finally {
      setFilesLoading(false)
    }
  }

  const onSearch = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setPage(1)
    const searchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setActiveSearchId(searchId)
    setScanStatus({
      search_id: searchId,
      status: 'running',
      started_at: null,
      updated_at: null,
      current_file: null,
      total_files: 0,
      files_scanned: 0,
      lines_scanned: 0,
      matches_found: 0,
      message: 'Preparing scan...',
    })

    try {
      if (includeExtensions.length === 0) {
        throw new Error('Select at least one file type')
      }
      if (!allFilesSelected && selectedFiles.length === 0) {
        throw new Error('Select at least one file or choose ALL files')
      }

      const payload = {
        ...buildPayload(),
        search_id: searchId,
        max_results: 2000,
      }
      const abortController = new AbortController()
      searchAbortRef.current = abortController

      const response = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({ detail: 'Search failed' }))
        throw new Error(body.detail || 'Search failed')
      }

      const data: SearchResponse = await response.json()
      setResults(data)
      setScanStatus((prev) =>
        prev
          ? {
              ...prev,
              status: 'completed',
              files_scanned: data.summary.total_files_scanned,
              lines_scanned: data.summary.total_lines_scanned,
              matches_found: data.summary.total_matches,
              message: 'Scan completed',
            }
          : prev
      )
      if (data.summary.total_files_scanned === 0) {
        setError('No matching files found under mounted root/subfolder for selected extensions.')
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setScanStatus((prev) =>
          prev
            ? {
                ...prev,
                status: 'cancelled',
                message: 'Scan cancelled',
              }
            : prev
        )
        return
      }
      setResults(null)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      searchAbortRef.current = null
      setLoading(false)
    }
  }

  const onCancelScan = async () => {
    if (!activeSearchId) {
      return
    }
    try {
      await fetch(`${API_BASE}/search-cancel?search_id=${encodeURIComponent(activeSearchId)}`, {
        method: 'POST',
      })
    } catch {
      // best effort
    }
    searchAbortRef.current?.abort()
    setLoading(false)
    setScanStatus((prev) =>
      prev
        ? {
            ...prev,
            status: 'cancelled',
            message: 'Cancel requested',
          }
        : prev
    )
  }

  const onExport = async (format: 'json' | 'csv') => {
    try {
      const payload = {
        ...buildPayload(),
        max_results: 100000,
        export_format: format,
      }

      const response = await fetch(`${API_BASE}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({ detail: 'Export failed' }))
        throw new Error(body.detail || 'Export failed')
      }

      const data = await response.json()
      const mime = format === 'json' ? 'application/json' : 'text/csv'
      const blob = new Blob([data.content], { type: mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = data.filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    }
  }

  const mountStatusTone = scanConfig?.exists && scanConfig?.readable ? 'text-emerald-700' : 'text-amber-700'

  return (
    <main className="min-h-screen w-full px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 rounded-2xl border border-slate-200 bg-white/85 p-6 shadow-sm backdrop-blur">
        <p className="mb-2 inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
          Docker-first log analytics
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">LogLens</h1>
        <p className="mt-2 text-sm text-slate-600">Search huge logs safely with streaming scans, date filters, regex, and export.</p>
      </header>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <aside className="space-y-6 lg:col-span-4">

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-slate-900">Search Filters</h2>
            <form onSubmit={onSearch} className="space-y-4">
              <Field label="Mounted Scan Root (read-only)">
                <input className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm" value={scanConfig?.scan_root ?? '/data/logs'} readOnly />
              </Field>

              <Field label="Subfolder (optional, relative)">
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  value={subfolder}
                  onChange={(e) => setSubfolder(e.target.value)}
                  placeholder="GT/ or UK/01"
                />
              </Field>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Target files</p>
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    onClick={loadFiles}
                    disabled={filesLoading}
                  >
                    {filesLoading ? 'Loading...' : 'Load files'}
                  </button>
                </div>
                <label className="mb-2 inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={allFilesSelected}
                    onChange={(e) => {
                      setAllFilesSelected(e.target.checked)
                      if (e.target.checked) {
                        setSelectedFiles([])
                      }
                    }}
                  />
                  ALL files
                </label>
                {!allFilesSelected && (
                  <div className="max-h-40 space-y-1 overflow-auto rounded border border-slate-200 bg-white p-2 text-xs">
                    {availableFiles.length === 0 && (
                      <p className="text-slate-500">Click \"Load files\" to fetch available files.</p>
                    )}
                    {availableFiles.map((file) => (
                      <label key={file} className="flex items-center gap-2 truncate">
                        <input
                          type="checkbox"
                          checked={selectedFiles.includes(file)}
                          onChange={(e) =>
                            setSelectedFiles((prev) =>
                              e.target.checked ? [...prev, file] : prev.filter((f) => f !== file)
                            )
                          }
                        />
                        <span className="truncate" title={file}>{file}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Start Date">
                  <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </Field>
                <Field label="Start Time">
                  <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </Field>
                <Field label="End Date">
                  <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </Field>
                <Field label="End Time">
                  <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </Field>
                <Field label="Context Lines (before/after)">
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    type="number"
                    min={0}
                    max={20}
                    value={contextLines}
                    onChange={(e) => setContextLines(Number(e.target.value || 0))}
                  />
                </Field>
              </div>

              {regexMode ? (
                <Field label="Regex Pattern">
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="857770.*3635623"
                  />
                </Field>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contains Terms (fast mode)</p>
                    <select
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                      value={termsOperator}
                      onChange={(e) => setTermsOperator(e.target.value as 'and' | 'or')}
                    >
                      <option value="and">Match ALL (AND)</option>
                      <option value="or">Match ANY (OR)</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    {terms.map((term, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                          value={term}
                          onChange={(e) =>
                            setTerms((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))
                          }
                          placeholder={`Term ${idx + 1}`}
                        />
                        {terms.length > 1 && (
                          <button
                            type="button"
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                            onClick={() => setTerms((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2">
                    <button
                      type="button"
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                      onClick={() => setTerms((prev) => [...prev, ''])}
                    >
                      + Add term
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={regexMode} onChange={(e) => setRegexMode(e.target.checked)} />Regex</label>
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={caseInsensitive} onChange={(e) => setCaseInsensitive(e.target.checked)} />Case insensitive</label>
              </div>

              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium text-slate-700">Files:</span>
                <label className="inline-flex items-center gap-1"><input type="checkbox" checked={includeLog} onChange={(e) => setIncludeLog(e.target.checked)} /> .log</label>
                <label className="inline-flex items-center gap-1"><input type="checkbox" checked={includeTxt} onChange={(e) => setIncludeTxt(e.target.checked)} /> .txt</label>
                <label className="inline-flex items-center gap-1"><input type="checkbox" checked={includeGz} onChange={(e) => setIncludeGz(e.target.checked)} /> .gz</label>
                <label className="inline-flex items-center gap-1"><input type="checkbox" checked={includeNoExt} onChange={(e) => setIncludeNoExt(e.target.checked)} /> no extension</label>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50" disabled={loading || configLoading}>
                  {loading ? 'Scanning...' : 'Search'}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  disabled={!loading}
                  onClick={onCancelScan}
                >
                  Cancel Scan
                </button>
                <button type="button" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => onExport('json')}>
                  Export JSON
                </button>
                <button type="button" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => onExport('csv')}>
                  Export CSV
                </button>
                <span className="text-xs text-slate-500">TODO: AI summarization and anomaly insight panel.</span>
              </div>
            </form>
          </section>

          {scanConfig && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">Mounted Path Status</h2>
                <span className={`text-xs font-semibold ${mountStatusTone}`}>
                  {scanConfig.exists && scanConfig.readable ? 'Ready' : 'Needs attention'}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <InfoPill label="Exists" value={String(scanConfig.exists)} />
                <InfoPill label="Readable" value={String(scanConfig.readable)} />
                <InfoPill label="Files Under Root" value={String(scanConfig.total_files_under_root)} />
              </div>
            </section>
          )}
        </aside>

        <section className="space-y-6 lg:col-span-8">
          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

          {scanStatus && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Scanner Status</h2>
                <span className="text-xs text-slate-500">{scanStatus.status}</span>
              </div>
              <p className="text-sm text-slate-700">{scanStatus.message || 'Scanning...'}</p>
              <p className="mt-1 text-xs text-slate-500 truncate" title={scanStatus.current_file || ''}>
                Current file: {scanStatus.current_file || '-'}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600 md:grid-cols-4">
                <div>Files: <strong>{scanStatus.files_scanned}/{scanStatus.total_files}</strong></div>
                <div>Lines: <strong>{scanStatus.lines_scanned.toLocaleString()}</strong></div>
                <div>Matches: <strong>{scanStatus.matches_found.toLocaleString()}</strong></div>
                <div>ID: <strong>{scanStatus.search_id}</strong></div>
              </div>
            </section>
          )}

          {results ? (
            <>
              <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <Stat title="Files Scanned" value={results.summary.total_files_scanned} />
                <Stat title="Lines Scanned" value={results.summary.total_lines_scanned} />
                <Stat title="Total Matches" value={results.summary.total_matches} />
                <Stat title="Returned Matches" value={results.matches.length} />
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-slate-900">Matching Lines</h2>
                  <div className="text-xs text-slate-500">
                    {results.truncated ? 'Result list truncated for performance.' : 'Showing paginated matches.'}
                  </div>
                </div>

                <div className="mb-3 flex items-center gap-2">
                  <button className="rounded-md border border-slate-300 px-2.5 py-1 text-sm disabled:opacity-50" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Prev
                  </button>
                  <span className="text-sm text-slate-600">Page {page} / {totalPages}</span>
                  <button className="rounded-md border border-slate-300 px-2.5 py-1 text-sm disabled:opacity-50" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </button>
                </div>

                <div className="max-h-[680px] overflow-auto rounded-xl border border-slate-200">
                  <table className="min-w-full text-left text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Message</th>
                        <th className="px-3 py-2">Timestamp</th>
                        <th className="px-3 py-2">File</th>
                        <th className="px-3 py-2">Line</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedMatches.map((row) => (
                        <tr key={`${row.file_path}-${row.line_number}`} className="border-t border-slate-100 align-top hover:bg-slate-50/70">
                          <td className="px-3 py-2 font-mono text-xs text-slate-800">
                            {row.context_before.length > 0 && (
                              <div className="mb-1 rounded bg-slate-50 p-2 text-slate-600">
                                {row.context_before.map((ctx) => (
                                  <div key={`b-${row.file_path}-${row.line_number}-${ctx.line_number}`}>
                                    <span className="mr-2 text-slate-400">{ctx.line_number}</span>
                                    {ctx.message}
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="rounded bg-blue-50 p-2 font-semibold text-slate-900">
                              <span className="mr-2 text-blue-600">{row.line_number}</span>
                              {row.message}
                            </div>
                            {row.context_after.length > 0 && (
                              <div className="mt-1 rounded bg-slate-50 p-2 text-slate-600">
                                {row.context_after.map((ctx) => (
                                  <div key={`a-${row.file_path}-${row.line_number}-${ctx.line_number}`}>
                                    <span className="mr-2 text-slate-400">{ctx.line_number}</span>
                                    {ctx.message}
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-700">{row.timestamp || '-'}</td>
                          <td className="max-w-[300px] truncate px-3 py-2 text-xs text-slate-600" title={row.file_path}>{row.file_path}</td>
                          <td className="px-3 py-2 text-slate-700">{row.line_number}</td>
                        </tr>
                      ))}
                      {paginatedMatches.length === 0 && (
                        <tr>
                          <td className="px-3 py-6 text-center text-slate-500" colSpan={4}>No matches for the current filters.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : (
            <section className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8 text-center shadow-sm">
              <h2 className="text-lg font-semibold text-slate-800">Results Panel</h2>
              <p className="mt-2 text-sm text-slate-600">Run a search from the left panel to view summary metrics and matching log lines here.</p>
            </section>
          )}
        </section>
      </section>

      <footer className="mt-8 pb-2 text-center text-xs text-slate-500">
        Built by George D&apos;Souza
      </footer>
    </main>
  )
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      {children}
    </div>
  )
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-800">{value}</p>
    </div>
  )
}

function Stat({ title, value }: { title: string; value: number }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-xs uppercase tracking-wide text-slate-500">{title}</h3>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value.toLocaleString()}</p>
    </article>
  )
}

export default App
