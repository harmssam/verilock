/**
 * Cmd+K global search modal — UI shell (wiring in Phase 2).
 */
import { useEffect, useRef, useState } from 'react'
import { EmptyState } from './EmptyState'
import './SearchModal.css'

interface SearchModalProps {
  open: boolean
  onClose: () => void
}

interface SearchResult {
  id: string
  title: string
  subtitle: string
  type: 'document' | 'ticket' | 'user' | 'settings'
}

export function SearchModal({ open, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setSelectedIndex(0)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [open])

  // Dummy search — will be wired to backend in Phase 2
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    // Simulate empty results for now
    setResults([])
  }, [query])

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
      // TODO: Navigate to result in Phase 2
    }
  }

  if (!open) return null

  return (
    <dialog className="av2-search-dialog" open>
      <div className="av2-search-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="av2-search-panel" role="dialog" aria-label="Search">
        <div className="av2-search-input-wrap">
          <span className="av2-search-input-icon" aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="av2-search-input"
            placeholder="Search documents, tickets, users..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Search"
          />
          <kbd className="av2-search-kbd">esc</kbd>
        </div>

        <div className="av2-search-results">
          {query.trim() && results.length === 0 && (
            <EmptyState
              icon="🔎"
              title="No results found"
              description={`No results for "${query}". Search will be wired in Phase 2.`}
            />
          )}
          {!query.trim() && (
            <div className="av2-search-hint">
              <p>Type to search across documents, tickets, and users.</p>
              <p className="av2-search-hint-kbd">
                <kbd>↑↓</kbd> to navigate · <kbd>↵</kbd> to open · <kbd>esc</kbd> to close
              </p>
            </div>
          )}
          {results.map((result, i) => (
            <button
              key={result.id}
              type="button"
              className={`av2-search-result${i === selectedIndex ? ' av2-search-result--selected' : ''}`}
              onClick={() => {
                // TODO: Navigate in Phase 2
              }}
            >
              <span className="av2-search-result-type">
                {result.type === 'document' ? '📄' : result.type === 'ticket' ? '🎫' : result.type === 'user' ? '👤' : '⚙️'}
              </span>
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
