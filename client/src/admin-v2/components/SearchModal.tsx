/**
 * Cmd+K global search modal — wired to GET /api/admin-v2/search?q=...
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { EmptyState } from './EmptyState'
import type { AdminV2Tab, StudioPane } from './Sidebar'
import './SearchModal.css'

interface SearchModalProps {
  open: boolean
  onClose: () => void
  onNavigate: (tab: AdminV2Tab, opts?: { studioPane?: StudioPane; emailId?: string; ticketId?: string }) => void
}

interface SearchResult {
  type: string
  id: string
  title: string
  subtitle: string
  url: string
}

const API_BASE = import.meta.env.VITE_API_URL ?? ''

function typeIcon(type: string): string {
  switch (type) {
    case 'ticket':
      return '🎫'
    case 'inbox':
      return '📬'
    case 'idea':
      return '💡'
    case 'document':
      return '📄'
    default:
      return '🔗'
  }
}

export function SearchModal({ open, onClose, onNavigate }: SearchModalProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Auto-focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setSelectedIndex(0)
      setLoading(false)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [open])

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)

    // Cancel previous request
    if (abortRef.current) {
      abortRef.current.abort()
    }
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(
        `${API_BASE}/api/admin-v2/search?q=${encodeURIComponent(q)}`,
        {
          credentials: 'include',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        },
      )
      if (!controller.signal.aborted && res.ok) {
        const data = await res.json()
        setResults(data.results || [])
        setSelectedIndex(0)
      }
    } catch {
      if (!controller.signal.aborted) {
        setResults([])
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    debounceRef.current = setTimeout(() => {
      void doSearch(query)
    }, 300)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [query, doSearch])

  // Parse URL and navigate
  const navigateToResult = useCallback(
    (result: SearchResult) => {
      onClose()

      // Parse the URL to determine tab and params
      if (result.type === 'document') {
        // External product page — use browser navigation
        window.open(result.url, '_blank')
        return
      }

      // Internal admin navigation via URL params
      const url = new URL(result.url, window.location.origin)
      const tabParam = url.searchParams.get('tab')

      if (tabParam === 'inbox' && result.type === 'inbox') {
        const emailId = url.searchParams.get('email') || undefined
        onNavigate('inbox', { emailId })
      } else if (tabParam === 'support' && result.type === 'ticket') {
        const ticketId = url.searchParams.get('ticket') || undefined
        onNavigate('support', { ticketId })
      } else if (tabParam === 'content' && result.type === 'idea') {
        onNavigate('content')
      } else {
        // Fallback
        const tab = (tabParam as AdminV2Tab) || 'dashboard'
        onNavigate(tab)
      }
    },
    [onClose, onNavigate],
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, results.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    }
    if (e.key === 'Enter' && results[selectedIndex]) {
      navigateToResult(results[selectedIndex])
    }
  }

  if (!open) return null

  return (
    <dialog className="av2-search-dialog" open>
      <div className="av2-search-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="av2-search-panel" role="dialog" aria-label="Search">
        <div className="av2-search-input-wrap">
          <span className="av2-search-input-icon" aria-hidden="true">
            🔍
          </span>
          <input
            ref={inputRef}
            type="text"
            className="av2-search-input"
            placeholder="Search documents, tickets, inbox..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Search"
          />
          <kbd className="av2-search-kbd">esc</kbd>
        </div>

        <div className="av2-search-results">
          {loading && (
            <div className="av2-search-hint">
              <p>Searching…</p>
            </div>
          )}
          {!loading && query.trim().length > 0 && query.trim().length < 2 && (
            <div className="av2-search-hint">
              <p>Type at least 2 characters to search.</p>
            </div>
          )}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <EmptyState
              icon="🔎"
              title="No results found"
              description={`No results for "${query}".`}
            />
          )}
          {!loading && !query.trim() && (
            <div className="av2-search-hint">
              <p>Type to search across documents, tickets, and inbox.</p>
              <p className="av2-search-hint-kbd">
                <kbd>↑↓</kbd> to navigate · <kbd>↵</kbd> to open · <kbd>esc</kbd> to close
              </p>
            </div>
          )}
          {!loading &&
            results.map((result, i) => (
              <button
                key={`${result.type}-${result.id}`}
                type="button"
                className={`av2-search-result${i === selectedIndex ? ' av2-search-result--selected' : ''}`}
                onClick={() => navigateToResult(result)}
              >
                <span className="av2-search-result-type">{typeIcon(result.type)}</span>
                <div className="av2-search-result-text">
                  <span className="av2-search-result-title">{result.title}</span>
                  <span className="av2-search-result-subtitle">{result.subtitle}</span>
                </div>
              </button>
            ))}
        </div>
      </div>
    </dialog>
  )
}
