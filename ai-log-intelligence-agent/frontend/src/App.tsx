import { useEffect, useMemo, useState } from 'react'
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

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'
const PAGE_SIZE = 50

function App() {
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

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<SearchResponse | null>(null)
  const [page, setPage] = useState(1)

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
    return ext
  }, [includeLog, includeTxt, includeGz])

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

    return {
      subfolder: '',
      include_extensions: includeExtensions,
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

  const onSearch = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setPage(1)

    try {
      if (includeExtensions.length === 0) {
        throw new Error('Select at least one file type')
      }

      const payload = {
        ...buildPayload(),
        max_results: 2000,
      }

      const response = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({ detail: 'Search failed' }))
        throw new Error(body.detail || 'Search failed')
      }

      const data: SearchResponse = await response.json()
      setResults(data)
      if (data.summary.total_files_scanned === 0) {
        setError('No matching files found under mounted root/subfolder for selected extensions.')
      }
    } catch (err) {
      setResults(null)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
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
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50" disabled={loading || configLoading}>
                  {loading ? 'Scanning...' : 'Search'}
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
